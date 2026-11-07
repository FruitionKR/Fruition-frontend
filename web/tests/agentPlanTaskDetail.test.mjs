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
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});
const agentPlan = await import("../src/features/agent-chat/lib/agentPlan.ts");

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
  "../lib/planAccess": {},
  "../model/useDocumentEditPreviews": { useDocumentEditPreviews: () => ({ state: "idle", previews: [], isFetching: false }) },
  "./DocumentEditPlanPreview": { DocumentEditPlanPreview: () => null },
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

// 로컬 브라우저의 1440·390 폭 확인용. 실제 카드 마크업과 CSS를 사용하며 운영 API는 호출하지 않는다.
if (process.env.PLAN_CARD_VISUAL_FIXTURE) {
  const css = readFileSync(new URL("../src/features/agent-chat/ui/AgentChat.module.css", import.meta.url), "utf8");
  writeFileSync(process.env.PLAN_CARD_VISUAL_FIXTURE, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:16px;box-sizing:border-box;font-family:sans-serif}main{max-width:380px;min-width:0}*{box-sizing:border-box}</style><main>${html.replace('<details class="plan-details">', '<details class="plan-details" open>')}</main>`);
}
