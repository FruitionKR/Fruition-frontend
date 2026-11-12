import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});
const approval = await import("../src/features/mcp-approval/lib/mcpApproval.ts");
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/mcp-approval/ui/McpApprovalPage.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const price = { unit_price_minor: 100, plan_cap_minor: 500, currency: "KRW", price_version: "v1", maximum_charge_minor: 100 };
let run = {
  id: "run-1", status: "awaiting_approval", error_code: null, origin: "MCP_CLIENT", grant_id: "grant-1", client_id: "https://client.example/metadata", policy_generation: 1,
  plan: { id: "plan-1", version: 1, operation_hash: "a".repeat(64), summary: "<script>bad()</script>", status: "awaiting_approval", operations: [{ id: "op-1", sequence: 1, tool_name: "apply_document_edit", target_id: "doc-1", arguments: {}, reason: "<img src=https://attacker.invalid/x>", status: "planned" }] },
  mcp_approval_quote: { client_name: "<img src=x onerror=alert(1)>", selected_operation_count: 1, price_snapshot: price }, mcp_settlement: null
};
let mutations = 0;
const aliases = {
  "@/shared/ui/modal/useConfirmation": { useConfirmation: () => ({ confirm: async () => false, confirmationDialog: null }) },
  "@/entities/user": { useMe: () => ({ data: { id: "user-1" }, isPending: false, error: null }) },
  "@/features/agent-chat/api/agentPlan": { cancelAgentPlanRun: async () => { mutations += 1; }, fetchAgentPlanRunById: async () => run },
  "@/features/agent-chat/lib/agentPlan": { agentPlanStatusLabel: () => "승인 대기", canApproveAgentPlan: () => true },
  "@/features/agent-chat/ui/AgentPlanTaskDetail": { AgentPlanTaskDetail: ({ mcpQuote, approvalDisabledReason }) => React.createElement("button", { type: "button" }, mcpQuote ? "Explicit approval only" : `Disabled: ${approvalDisabledReason}`) },
  "@/shared/lib/apiErrors": { LoginRequiredError: class LoginRequiredError extends Error {} },
  "@/shared/lib/authSessionStorage": { setAfterLoginPath() {} },
  "../lib/mcpApproval": approval,
  "../lib/wikiDraftPreview": await import("../src/features/mcp-approval/lib/wikiDraftPreview.ts"),
  "./McpApprovalPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) },
  "next/navigation": { useRouter: () => ({ replace() {} }) },
  "next-intl": { useTranslations: () => (key, values) => values ? `${key}(${Object.values(values).join(",")})` : key, useFormatter: () => ({ number: (value) => `KRW ${value}` }) },
  "@tanstack/react-query": {
    useQuery: () => ({ data: run, error: null, isPending: false, isFetching: false, refetch() {} }),
    useQueryClient: () => ({ removeQueries() {}, setQueryData() {}, invalidateQueries() {} }),
    useMutation: () => ({ isPending: false, error: null, mutate: () => { mutations += 1; } })
  }
};
const exports = {};
runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id), window: { addEventListener() {}, removeEventListener() {}, confirm: () => true } });
const McpApprovalPage = exports.default;

test("MCP review renders untrusted labels as text and never approves, cancels, or replans on mount", () => {
  mutations = 0;
  const html = renderToStaticMarkup(React.createElement(McpApprovalPage, { workspaceId: "ws-1", runId: "run-1" }));
  assert.equal(mutations, 0);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<script|revise|regenerate/i);
  assert.match(html, /KRW 100/);
  assert.match(html, /Explicit approval only/);
});

test("source version conflicts keep the registered client visible but approval disabled with a distinct reason", () => {
  const current = run;
  run = { ...run, mcp_approval_quote: { client_name: "Claude Code", unavailable_reason: "TARGET_VERSION_CHANGED" } };
  const html = renderToStaticMarkup(React.createElement(McpApprovalPage, { workspaceId: "ws-1", runId: "run-1" }));
  run = current;
  assert.match(html, /Claude Code/);
  assert.match(html, /unavailable.target_version_changed/);
  assert.match(html, /Disabled:/);
  assert.doesNotMatch(html, /Explicit approval only/);
});

test("run review leads with what changes, a human status and one cost line; technical values are collapsed", () => {
  const html = renderToStaticMarkup(React.createElement(McpApprovalPage, { workspaceId: "ws-1", runId: "run-1" }));
  const at = html.indexOf("<details");
  assert.ok(at > 0);
  const visible = html.slice(0, at);
  const details = html.slice(at);
  assert.match(visible, /<h1[^>]*>headline\.editDocuments\(&lt;img src=x onerror=alert\(1\)&gt;,1\)<\/h1>/);
  assert.match(visible, /data-tone="pending"[^>]*>승인 대기</);
  assert.match(visible, /cost\.maximum\(KRW 100\)/);
  for (const raw of ["grant-1", "a".repeat(64), "https://client.example/metadata", ">v1<", "fees.scope", "awaiting_approval"]) {
    assert.ok(!visible.includes(raw), `${raw} is not shown up front`);
    assert.ok(details.includes(raw), `${raw} is in details`);
  }
});

test("settled run shows the charged amount and maps unknown settlement codes to a neutral label", () => {
  const current = run;
  run = { ...run, status: "completed", mcp_settlement: {
    approval_id: "a-1", execution_status: "SOMETHING_NEW", forward_status: "ACCEPTED", settlement_status: "SETTLED",
    charged_minor: 70, maximum_charge_minor: 100, currency: "KRW", client_name: "Claude Code", price_snapshot: price
  } };
  const html = renderToStaticMarkup(React.createElement(McpApprovalPage, { workspaceId: "ws-1", runId: "run-1" }));
  run = current;
  const at = html.indexOf("<details");
  assert.match(html.slice(0, at), /data-tone="success"/);
  assert.match(html.slice(0, at), /cost\.charged\(KRW 70\)/);
  assert.match(html.slice(at), /execution\.OTHER/);
  assert.match(html.slice(at), /settlementStatus\.SETTLED/);
});
