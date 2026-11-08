import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useTranslations } from "./fakeNextIntl.mjs";

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const agentChatT = useTranslations("agentChat");

// 앱 소스의 확장자 없는 상대 import(./agentChatTranslator)를 .ts로 푼다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});
const agentPlan = await import("../src/features/agent-chat/lib/agentPlan.ts");
const mcpApproval = await import("../src/features/mcp-approval/lib/mcpApproval.ts");
let previewFixture = { state: "idle", previews: null, isFetching: false, isExpired: false, canRetry: false, refetch() {} };

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/agent-chat/ui/AgentPlanTaskDetail.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;
const aliases = {
  "@tanstack/react-query": { useQuery: () => ({ data: [], isFetching: false }), useQueryClient: () => ({}), useMutation: () => ({ isPending: false }) },
  "@/shared/api/client": { readWorkspaceId: () => "fixture-workspace" },
  "@/shared/lib/apiErrors": { getErrorMessage: () => "조회 실패" },
  // 화면과 같이 agentChat 메시지를 한국어로 푼다.
  "next-intl": { useTranslations: () => agentChatT },
  "../lib/agentChatError": { agentChatErrorMessage: () => "조회 실패" },
  "@/entities/wiki": { documentDataQueryKey: () => ["fixture-tree"] },
  "../api/agentPlan": {},
  "../lib/agentPlan": agentPlan,
  "../lib/folderOrganize": {},
  "@/entities/workspace": { useWorkspaceRole: () => ({ role: "OWNER", isOwner: true }) },
  "@/entities/document/api/trash": { TRASH_QUERY_KEY: () => ["fixture-trash"] },
  "../lib/documentEditPlan": { isDocumentEditPlan: () => false, blockedEditRowIds: () => new Set(), documentEditRowsNeedTrash: () => false },
  "../lib/planAccess": {
    checkPlanAccess: () => ({ blockedOperationIds: new Set(), verdict: "allowed", blockedCount: 0 }),
    checkRowAccess: () => null,
    planAccessMessage: () => null
  },
  "../model/useDocumentEditPreviews": { useDocumentEditPreviews: () => previewFixture },
  "./DocumentEditPlanPreview": {
    DocumentEditDiff: ({ row }) => React.createElement("pre", null, row.hunks?.flatMap((hunk) => hunk.lines.map((line) => line.text)).join("\n")),
    DocumentEditPlanPreview: () => null
  },
  "@/features/mcp-approval/lib/mcpApproval": mcpApproval,
  "@/features/notion-import/lib/notionLinks": { documentHref: (id) => `/home?doc=${encodeURIComponent(id)}` },
  "../model/useFolderOrganizeDeselection": { useFolderOrganizeDeselection: () => [new Set(), () => {}] },
  "@/shared/lib/classNames": { cx: (...values) => values.filter(Boolean).join(" ") },
  "./AgentIcons": { AgentAssetIcon: () => null },
  "./AgentChat.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) }
};
const exports = {};
runInNewContext(output, { exports, require: (id) => id.endsWith(".svg") ? "fixture-icon" : aliases[id] ?? require(id) });
const { AgentPlanTaskDetail } = exports;
const operation = (id, status, error_code) => ({ id, sequence: 1, tool_name: "move_document", target_id: null, arguments: {}, reason: "검증용 설명", status, error_code });
const run = { id: "fixture-run", status: "failed", plan: { id: "fixture-plan", version: 1, operation_hash: "fixture-hash", status: "failed", operations: [
  operation("fixture-forbidden", "forbidden", "tool_http_403"),
  operation("fixture-conflicted", "conflicted", "tool_http_409"),
  operation("fixture-skipped", "skipped", "dependency_failed"),
  operation("fixture-unselected", "skipped", "not_selected"),
  operation("fixture-success", "succeeded", null)
] } };
const html = renderToStaticMarkup(React.createElement(AgentPlanTaskDetail, { turnId: "fixture-turn", action: "document_edit", run, isRunFetching: false, onRefetch() {} }));

test("실제 계획 카드 행은 실패 이유를 표시하고 제외·성공 행은 유지한다", () => {
  assert.equal((html.match(/class="plan-operation-blocked"/g) ?? []).length, 3);
  assert.match(html, /권한이 없어/);
  assert.match(html, /그 사이 내용이 바뀌어/);
  assert.match(html, /앞선 작업이 실패해/);
  assert.match(html, /제외됨/);
  assert.match(html, /완료/);
  assert.doesNotMatch(html, /tool_http_|dependency_failed|fixture-forbidden/);
});

test("MCP 혼합 계획은 일곱 도구, 경고, 상태 구분과 create/edit preview를 한 검토 카드에 표시한다", () => {
  const tools = ["create_folder", "create_document", "rename_folder", "rename_document", "move_folder", "move_document", "apply_document_edit"];
  const operations = tools.map((tool_name, index) => ({
    id: `op-${index + 1}`, sequence: index + 1, tool_name, target_id: tool_name.startsWith("create_") ? null : `target-${index}`,
    arguments: tool_name === "create_folder" ? { name: "Folder", parent_folder_id: null }
      : tool_name === "create_document" ? { display_name: "New.md", folder_id: { $operation_result: "op-1" } }
      : {},
    reason: `reason-${index + 1}`, status: "planned", error_code: null,
    depends_on: tool_name === "create_document" ? ["op-1"] : [],
    warning: index === 1 ? { type: "duplicate_content", message: "Untrusted duplicate warning" } : null,
    suggested_selected: true,
    existing_result: index === 0 ? { resource_type: "FOLDER", resource_id: "folder-id", current_version: 2 } : null
  }));
  previewFixture = {
    state: "ready", isFetching: false, isExpired: false, canRetry: false, refetch() {},
    previews: { expires_at: null, items: [
      { operation_id: "op-2", tool_name: "create_document", document_id: null, base_version: null, display_name: "New.md", summary: "Create", added_lines: 1, removed_lines: 0, hunks: [{ before_start: 1, after_start: 1, lines: [{ type: "insert", text: "<img src=https://attacker.invalid/x> ![x](https://attacker.invalid/y)" }] }] },
      { operation_id: "op-7", tool_name: "apply_document_edit", document_id: "doc-1", base_version: 1, display_name: "Edit.md", summary: "Edit", added_lines: 1, removed_lines: 1, hunks: [{ before_start: 1, after_start: 1, lines: [{ type: "insert", text: "safe text" }] }] }
    ] }
  };
  const mixedRun = { id: "mcp-run", status: "awaiting_approval", plan: { id: "mcp-plan", version: 1, operation_hash: "a".repeat(64), summary: "Review all", status: "awaiting_approval", operations } };
  const mixedHtml = renderToStaticMarkup(React.createElement(AgentPlanTaskDetail, {
    turnId: "mcp-run", action: "mcp_plan", run: mixedRun, runError: null, isRunFetching: false, onRefetch() {},
    mcpContext: { workspaceId: "ws", userId: "user", runId: "mcp-run" },
    mcpQuote: { client_name: "client", selected_operation_count: 7, price_snapshot: { unit_price_minor: 100, plan_cap_minor: 500, currency: "KRW", price_version: "v1", maximum_charge_minor: 500 } }
  }));
  for (const text of ["폴더 생성", "문서 생성", "이름 변경", "문서 편집"]) assert.match(mixedHtml, new RegExp(text));
  assert.match(mixedHtml, /Untrusted duplicate warning/);
  assert.match(mixedHtml, /새 문서 내용 미리보기/);
  assert.match(mixedHtml, /문서 편집 미리보기/);
  assert.match(mixedHtml, /기존 결과를 재사용/);
  assert.doesNotMatch(mixedHtml, /<script|<img/i);
  assert.match(mixedHtml, /&lt;img src=https:\/\/attacker\.invalid\/x&gt;/);
});

test("MCP는 선택한 create preview가 없으면 승인을 막고 실행·정산 상태를 서로 다르게 설명한다", () => {
  const create = { id: "create", sequence: 1, tool_name: "create_document", target_id: null, arguments: { display_name: "New.md", folder_id: null }, reason: "create", status: "planned", error_code: null, depends_on: [] };
  previewFixture = { state: "ready", previews: { items: [], expires_at: null }, isFetching: false, isExpired: false, canRetry: false, refetch() {} };
  const awaiting = { id: "run", status: "awaiting_approval", plan: { id: "plan", version: 1, operation_hash: "a".repeat(64), summary: "review", status: "awaiting_approval", operations: [create] } };
  const blockedHtml = renderToStaticMarkup(React.createElement(AgentPlanTaskDetail, {
    turnId: "run", action: "mcp_plan", run: awaiting, runError: null, isRunFetching: false, onRefetch() {},
    mcpContext: { workspaceId: "ws", userId: "user", runId: "run" },
    mcpQuote: { client_name: "client", selected_operation_count: 1, price_snapshot: { unit_price_minor: 100, plan_cap_minor: 500, currency: "KRW", price_version: "v1", maximum_charge_minor: 100 } }
  }));
  assert.match(blockedHtml, /미리보기가 없거나 올바르지 않거나 만료/);
  assert.match(blockedHtml, /aria-label="수락하고 실행" disabled/);

  const resultOperations = [
    { ...create, id: "held", status: "skipped", error_code: "mcp_create_pending_reconciliation" },
    { ...create, id: "budget", sequence: 2, status: "skipped", error_code: "react_tool_budget_insufficient" },
    { ...create, id: "unknown", sequence: 3, status: "running" },
    { ...create, id: "existing", sequence: 4, status: "succeeded", existing_result: { resource_type: "DOCUMENT", resource_id: "doc-existing", current_version: 4 } }
  ];
  const resultRun = {
    ...awaiting, status: "completed",
    plan: { ...awaiting.plan, status: "completed", operations: resultOperations },
    mcp_settlement: { forward_status: "UNKNOWN", settlement_status: "PENDING_RECONCILIATION" }
  };
  const resultHtml = renderToStaticMarkup(React.createElement(AgentPlanTaskDetail, {
    turnId: "run", action: "mcp_plan", run: resultRun, runError: null, isRunFetching: false, onRefetch() {},
    mcpContext: { workspaceId: "ws", userId: "user", runId: "run" }
  }));
  assert.match(resultHtml, /생성을 보류/);
  assert.match(resultHtml, /실행 예산이 소진/);
  assert.match(resultHtml, /영수증을 아직 대사 중/);
  assert.match(resultHtml, /기존 결과를 재사용/);
});

// 로컬 브라우저의 1440·390 폭 확인용. 실제 카드 마크업과 CSS를 사용하며 운영 API는 호출하지 않는다.
if (process.env.PLAN_CARD_VISUAL_FIXTURE) {
  const css = readFileSync(new URL("../src/features/agent-chat/ui/AgentChat.module.css", import.meta.url), "utf8");
  writeFileSync(process.env.PLAN_CARD_VISUAL_FIXTURE, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:16px;box-sizing:border-box;font-family:sans-serif}main{max-width:380px;min-width:0}*{box-sizing:border-box}</style><main>${html.replace('<details class="plan-details">', '<details class="plan-details" open>')}</main>`);
}
