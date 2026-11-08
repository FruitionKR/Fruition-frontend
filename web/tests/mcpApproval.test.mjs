import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const {
  canCancelMcpRun,
  initialMcpSelectedOperationIds,
  mcpApprovalAvailability,
  mcpApprovalQueryKey,
  mcpApprovalRoute,
  mcpApprovalSelectionKey,
  mcpConvertedSource,
  mcpSkillDefinition,
  mcpDecisionErrorKey,
  shouldPollMcpApproval,
  mcpPriceSnapshotForSelection,
  toggleMcpOperationSelection,
  validMcpOperationSelection,
  validMcpPriceSnapshot
} = await import("../src/features/mcp-approval/lib/mcpApproval.ts");

const price = { unit_price_minor: 100, plan_cap_minor: 500, currency: "KRW", price_version: "2026-11", maximum_charge_minor: 100 };
const operation = { id: "op-1", sequence: 1, tool_name: "apply_document_edit", target_id: "doc_1", source_parent_id: null, destination_parent_id: null, arguments: {}, reason: "<img src=https://attacker.invalid/x>", status: "planned" };
const plan = { id: "plan-1", version: 2, operation_hash: "a".repeat(64), summary: "<script>alert(1)</script>", status: "awaiting_approval", operations: [operation] };
const run = {
  id: "run-1", status: "awaiting_approval", error_code: null, origin: "MCP_CLIENT", grant_id: "grant-1", client_id: "https://client.example/metadata",
  policy_generation: 3, plan, mcp_approval_quote: { client_name: "<img src=x onerror=alert(1)>", selected_operation_count: 1, price_snapshot: price }
};

test("route and cache identity bind the account, target workspace, and run", () => {
  assert.equal(mcpApprovalRoute("ws/one", "run two"), "/mcp/workspaces/ws%2Fone/runs/run%20two");
  assert.deepEqual(mcpApprovalQueryKey("user-1", "ws/one", "run two"), ["mcpApproval", "user-1", "ws/one", "run two"]);
  assert.notEqual(mcpApprovalSelectionKey("user-1", "ws", "run", plan), mcpApprovalSelectionKey("user-2", "ws", "run", plan));
  assert.notEqual(mcpApprovalSelectionKey("user-1", "ws", "run", plan), mcpApprovalSelectionKey("user-1", "other", "run", plan));
  assert.notEqual(mcpApprovalSelectionKey("user-1", "ws", "run", plan), mcpApprovalSelectionKey("user-1", "ws", "run", { ...plan, version: 3 }));
});

test("server-attributed 1..20 supported operations with an exact KRW quote are approvable", () => {
  assert.deepEqual(mcpApprovalAvailability(run), { available: true, priceSnapshot: price });
  assert.equal(mcpApprovalAvailability({ ...run, origin: "WEB_AGENT" }).reason, "not_mcp");
  assert.equal(mcpApprovalAvailability({ ...run, grant_id: null }).reason, "missing_authority");
  const tools = ["create_folder", "create_document", "rename_folder", "rename_document", "move_folder", "move_document", "apply_document_edit"];
  const mixed = tools.map((tool_name, index) => ({ ...operation, id: `op-${index + 1}`, sequence: index + 1, tool_name }));
  assert.deepEqual(mcpApprovalAvailability({ ...run, plan: { ...plan, operations: mixed } }), {
    available: true,
    priceSnapshot: { ...price, maximum_charge_minor: 500 }
  });
  const twenty = Array.from({ length: 20 }, (_, index) => ({ ...operation, id: `op-${index + 1}`, sequence: index + 1 }));
  assert.equal(mcpApprovalAvailability({ ...run, plan: { ...plan, operations: twenty } }).available, true);
  assert.equal(mcpApprovalAvailability({ ...run, plan: { ...plan, operations: [...twenty, { ...operation, id: "op-21", sequence: 21 }] } }).reason, "unsupported_plan");
  assert.equal(mcpApprovalAvailability({ ...run, plan: { ...plan, operations: [{ ...operation, tool_name: "delete_document" }] } }).reason, "unsupported_plan");
  assert.equal(mcpApprovalAvailability({ ...run, mcp_approval_quote: { client_name: "Claude Code", unavailable_reason: "TARGET_VERSION_CHANGED" } }).reason, "target_version_changed");
  assert.equal(mcpApprovalAvailability({ ...run, mcp_approval_quote: null }).reason, "quote_unavailable");
  assert.equal(mcpApprovalAvailability({ ...run, mcp_approval_quote: { ...run.mcp_approval_quote, selected_operation_count: 2 } }).reason, "quote_mismatch");
  assert.equal(validMcpPriceSnapshot({ ...price, currency: "mKRW" }), false, "ledger milli-KRW is not a browser quote");
  assert.equal(validMcpPriceSnapshot({ ...price, maximum_charge_minor: undefined }), false, "missing amounts never default to zero");
  assert.equal(validMcpPriceSnapshot({ ...price, unit_price_minor: 0 }), false, "zero price fails closed");
  assert.equal(mcpPriceSnapshotForSelection({ client_name: "client", selected_operation_count: 1, price_snapshot: { ...price, unit_price_minor: Number.MAX_SAFE_INTEGER } }, ["one", "two"]), null, "unsafe multiplication fails closed");
  assert.deepEqual(mcpApprovalAvailability({ ...run, plan: { ...plan, operations: [{ ...operation, suggested_selected: false }] } }), {
    available: true,
    priceSnapshot: { ...price, maximum_charge_minor: 0 }
  }, "all warnings may default to zero selected, but explicit user selection can still enable approval");
});

test("selection starts from deterministic warnings, stays dependency-closed, and preserves plan order", () => {
  const dependencyPlan = { ...plan, operations: [
    { ...operation, id: "folder", sequence: 1, tool_name: "create_folder" },
    { ...operation, id: "document", sequence: 2, tool_name: "create_document", arguments: { folder_id: { $operation_result: "folder" } }, depends_on: ["folder"] },
    { ...operation, id: "edit", sequence: 3, suggested_selected: false }
  ] };
  assert.deepEqual(initialMcpSelectedOperationIds(dependencyPlan), ["folder", "document"]);
  assert.deepEqual(toggleMcpOperationSelection(dependencyPlan, ["folder", "document"], "folder"), [], "clearing a parent clears dependents");
  assert.deepEqual(toggleMcpOperationSelection(dependencyPlan, [], "document"), ["folder", "document"], "selecting a dependent selects requirements");
  assert.equal(validMcpOperationSelection(dependencyPlan, ["folder", "document"]), true);
  assert.equal(validMcpOperationSelection(dependencyPlan, ["document"]), false);
  assert.equal(validMcpOperationSelection(dependencyPlan, ["document", "folder"]), false, "request order is canonical plan order");
  assert.deepEqual(mcpPriceSnapshotForSelection(run.mcp_approval_quote, ["folder", "document"]), { ...price, maximum_charge_minor: 200 });
});

test("terminal execution keeps polling while forwarding or settlement remains uncertain", () => {
  const settlement = { approval_id: "approval-1", execution_status: "HALTED", forward_status: "ACCEPTED", settlement_status: "PENDING_RECONCILIATION", charged_minor: 0, maximum_charge_minor: 100, currency: "KRW" };
  assert.equal(shouldPollMcpApproval({ ...run, status: "halted", mcp_settlement: settlement }), true);
  assert.equal(shouldPollMcpApproval({ ...run, status: "completed", mcp_settlement: { ...settlement, execution_status: "FORWARDED", forward_status: "UNKNOWN", settlement_status: "SETTLED" } }), true);
  assert.equal(shouldPollMcpApproval({ ...run, status: "completed", mcp_settlement: { ...settlement, execution_status: "FORWARDED", settlement_status: "SETTLED" } }), false);
  assert.equal(canCancelMcpRun("halted"), true);
  assert.equal(canCancelMcpRun("completed"), false);
});

test("approval errors distinguish hard denial from an ambiguous result that needs GET refresh", () => {
  assert.equal(mcpDecisionErrorKey({ status: 402 }), "credit");
  assert.equal(mcpDecisionErrorKey({ status: 409 }), "conflict");
  assert.equal(mcpDecisionErrorKey({ status: 403 }), "forbidden");
  assert.equal(mcpDecisionErrorKey({ status: 404 }), "missing");
  assert.equal(mcpDecisionErrorKey({ status: 503, code: "MCP_PRICE_UNCONFIGURED" }), "price");
  assert.equal(mcpDecisionErrorKey({ status: 504 }), "ambiguous");
  assert.equal(mcpDecisionErrorKey(new TypeError("Failed to fetch")), "ambiguous");
});

test("PDF conversion create shows its pinned source and a half or malformed source pair blocks approval", () => {
  const hash = `sha256:${"b".repeat(64)}`;
  const convert = (args) => ({ ...operation, tool_name: "create_document", target_id: null,
    arguments: { display_name: "x", folder_id: null, content_artifact_id: "artifact-1", content_hash: hash, ...args } });
  const withOperation = (op) => ({ ...run, plan: { ...plan, operations: [op] } });
  const valid = convert({ source_document_id: "doc_pdf", source_content_hash: hash });

  assert.deepEqual(mcpConvertedSource(valid), { documentId: "doc_pdf", contentHash: hash });
  assert.equal(mcpConvertedSource(convert({})), null);
  assert.equal(mcpApprovalAvailability(withOperation(valid)).available, true);
  for (const broken of [convert({ source_document_id: "doc_pdf" }), convert({ source_document_id: "doc_pdf", source_content_hash: "sha256:XYZ" }),
    { ...operation, arguments: { source_document_id: "doc_pdf", source_content_hash: hash } }]) {
    assert.equal(mcpConvertedSource(broken), "invalid");
    assert.deepEqual(mcpApprovalAvailability(withOperation(broken)), { available: false, reason: "unsupported_plan" });
  }
});

test("Skill definition publish is a strict single read-only operation and any drift blocks approval", () => {
  const skillId = "00000000-0000-4000-8000-000000000009";
  const definition = { skill_id: skillId, expected_version: 3, scope_type: "team", name: "weekly-summary", description: "요약",
    instructions_markdown: "<script>x</script> {문서}", capabilities: ["document-edit"], allowed_tools: ["apply_document_edit"],
    targets: ["current_document"], result_mode: "edit", requires_source: true };
  const skill = (args, extra = {}) => ({ ...operation, tool_name: "publish_skill_definition", target_id: skillId, base_version: 3,
    depends_on: [], arguments: { ...definition, ...args }, ...extra });
  const withOperations = (operations) => ({ ...run, plan: { ...plan, operations } });

  assert.deepEqual(mcpSkillDefinition(skill({})), definition);
  assert.equal(mcpSkillDefinition(skill({ skill_id: null, expected_version: null }, { target_id: null, base_version: null })).expected_version, null);
  assert.equal(mcpSkillDefinition(operation), null);
  assert.equal(mcpApprovalAvailability(withOperations([skill({})])).available, true);
  for (const broken of [skill({ extra: 1 }), skill({ expected_version: 4 }), skill({ scope_type: "public" }), skill({ capabilities: [] }),
    skill({ targets: ["folder"] }), skill({ skill_id: null }), skill({}, { depends_on: ["op-0"] })]) {
    assert.equal(mcpSkillDefinition(broken), "invalid");
    assert.deepEqual(mcpApprovalAvailability(withOperations([broken])), { available: false, reason: "unsupported_plan" });
  }
  const mixed = withOperations([skill({}), { ...operation, id: "op-2", sequence: 2 }]);
  assert.deepEqual(mcpApprovalAvailability({ ...mixed, mcp_approval_quote: { ...run.mcp_approval_quote, selected_operation_count: 2 } }),
    { available: false, reason: "unsupported_plan" });
});
