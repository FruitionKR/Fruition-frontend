import {
  canApproveAgentPlan,
  shouldPollAgentPlan,
  type AgentPlan,
  type AgentPlanOperation,
  type AgentPlanRun,
  type McpApprovalQuote,
  type McpPriceSnapshot
} from "@/features/agent-chat/lib/agentPlan";

const MCP_PLAN_TOOLS = new Set([
  "create_folder", "create_document", "rename_folder", "rename_document",
  "move_folder", "move_document", "apply_document_edit"
]);
const MAX_MCP_OPERATIONS = 20;

export function mcpApprovalRoute(workspaceId: string, runId: string): string {
  return `/mcp/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}`;
}

export const mcpApprovalQueryKey = (userId: string, workspaceId: string, runId: string) =>
  ["mcpApproval", userId, workspaceId, runId] as const;

export const mcpApprovalSelectionKey = (userId: string, workspaceId: string, runId: string, plan: Pick<AgentPlan, "version" | "operation_hash">) =>
  `${userId}:${workspaceId}:${runId}:${plan.version}:${plan.operation_hash}`;

function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function validMcpPriceSnapshot(value: unknown): value is McpPriceSnapshot {
  if (!value || typeof value !== "object") return false;
  const price = value as Partial<McpPriceSnapshot>;
  return validMoney(price.unit_price_minor)
    && validMoney(price.plan_cap_minor)
    && validMoney(price.maximum_charge_minor)
    && price.currency === "KRW"
    && typeof price.price_version === "string"
    && price.price_version.trim().length > 0;
}

export type McpApprovalAvailability =
  | { available: true; priceSnapshot: McpPriceSnapshot }
  | { available: false; reason: "not_mcp" | "missing_authority" | "unsupported_plan" | "quote_unavailable" | "quote_mismatch" | "not_approvable" };

function referencedOperationIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencedOperationIds);
  if (!value || typeof value !== "object") return [];
  if ("$operation_result" in value && typeof value.$operation_result === "string") return [value.$operation_result];
  return Object.values(value).flatMap(referencedOperationIds);
}

function orderedOperations(plan: AgentPlan): AgentPlanOperation[] {
  return [...plan.operations].sort((a, b) => a.sequence - b.sequence);
}

function operationDependencies(operation: AgentPlanOperation): string[] {
  return [...new Set([...(operation.depends_on ?? []), ...referencedOperationIds(operation.arguments)])];
}

function validMcpPlan(plan: AgentPlan | null | undefined): plan is AgentPlan {
  if (!plan || plan.operations.length < 1 || plan.operations.length > MAX_MCP_OPERATIONS) return false;
  const ordered = orderedOperations(plan);
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const [index, operation] of ordered.entries()) {
    if (!operation.id?.trim() || ids.has(operation.id) || !MCP_PLAN_TOOLS.has(operation.tool_name)
      || operation.sequence !== index + 1 || sequences.has(operation.sequence)) return false;
    const earlier = new Set(ordered.filter((candidate) => candidate.sequence < operation.sequence).map((candidate) => candidate.id));
    if (operationDependencies(operation).some((id) => !earlier.has(id))) return false;
    ids.add(operation.id);
    sequences.add(operation.sequence);
  }
  return true;
}

/** 서버 권장 선택을 계획 순서로 좁히되, 의존 작업이 빠진 항목은 실행 권한으로 만들지 않는다. */
export function initialMcpSelectedOperationIds(plan: AgentPlan): string[] {
  const ordered = orderedOperations(plan);
  const selected = new Set(ordered.filter((operation) => operation.suggested_selected !== false).map((operation) => operation.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of ordered) {
      if (selected.has(operation.id) && operationDependencies(operation).some((id) => !selected.has(id))) {
        selected.delete(operation.id);
        changed = true;
      }
    }
  }
  return ordered.map((operation) => operation.id).filter((id) => selected.has(id));
}

/** 선택하면 선행 작업도, 해제하면 그 결과에 기대는 후속 작업도 함께 바꾼다. */
export function toggleMcpOperationSelection(plan: AgentPlan, currentIds: readonly string[], operationId: string): string[] {
  const ordered = orderedOperations(plan);
  const operations = new Map(ordered.map((operation) => [operation.id, operation]));
  const selected = new Set(currentIds);
  if (selected.has(operationId)) {
    selected.delete(operationId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const operation of ordered) {
        if (selected.has(operation.id) && operationDependencies(operation).some((id) => !selected.has(id))) {
          selected.delete(operation.id);
          changed = true;
        }
      }
    }
  } else {
    const pending = [operationId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      const operation = operations.get(id);
      if (!operation || selected.has(id)) continue;
      selected.add(id);
      pending.push(...operationDependencies(operation));
    }
  }
  return ordered.map((operation) => operation.id).filter((id) => selected.has(id));
}

export function validMcpOperationSelection(plan: AgentPlan, operationIds: readonly string[]): boolean {
  if (operationIds.length < 1 || operationIds.length > MAX_MCP_OPERATIONS || new Set(operationIds).size !== operationIds.length) return false;
  const canonical = orderedOperations(plan).map((operation) => operation.id).filter((id) => operationIds.includes(id));
  if (canonical.length !== operationIds.length || canonical.some((id, index) => id !== operationIds[index])) return false;
  const selected = new Set(operationIds);
  return orderedOperations(plan).filter((operation) => selected.has(operation.id))
    .every((operation) => operationDependencies(operation).every((id) => selected.has(id)));
}

export function mcpPriceSnapshotForSelection(quote: McpApprovalQuote, operationIds: readonly string[]): McpPriceSnapshot | null {
  if (!validMcpPriceSnapshot(quote.price_snapshot) || operationIds.length > MAX_MCP_OPERATIONS) return null;
  const { unit_price_minor, plan_cap_minor, currency, price_version } = quote.price_snapshot;
  if (operationIds.length > 0 && unit_price_minor > Number.MAX_SAFE_INTEGER / operationIds.length) return null;
  return {
    unit_price_minor,
    plan_cap_minor,
    currency,
    price_version,
    maximum_charge_minor: Math.min(unit_price_minor * operationIds.length, plan_cap_minor)
  };
}

export function mcpApprovalAvailability(run: AgentPlanRun | null | undefined): McpApprovalAvailability {
  if (run?.origin !== "MCP_CLIENT") return { available: false, reason: "not_mcp" };
  if (!run.grant_id?.trim() || !run.client_id?.trim() || typeof run.policy_generation !== "number" || !Number.isSafeInteger(run.policy_generation) || run.policy_generation < 1) {
    return { available: false, reason: "missing_authority" };
  }
  if (!canApproveAgentPlan(run)) return { available: false, reason: "not_approvable" };
  if (!validMcpPlan(run.plan)) return { available: false, reason: "unsupported_plan" };
  const quote = run.mcp_approval_quote;
  if (!quote?.client_name?.trim() || !validMcpPriceSnapshot(quote.price_snapshot)) {
    return { available: false, reason: "quote_unavailable" };
  }
  if (!Number.isSafeInteger(quote.selected_operation_count) || quote.selected_operation_count < 1
    || quote.selected_operation_count > run.plan.operations.length || quote.selected_operation_count > MAX_MCP_OPERATIONS) {
    return { available: false, reason: "quote_mismatch" };
  }
  const quotedIds = run.plan.operations.slice(0, quote.selected_operation_count).map((operation) => operation.id);
  const quotedPrice = mcpPriceSnapshotForSelection(quote, quotedIds);
  if (!quotedPrice || quotedPrice.maximum_charge_minor !== quote.price_snapshot.maximum_charge_minor) {
    return { available: false, reason: "quote_mismatch" };
  }
  const selectedPrice = mcpPriceSnapshotForSelection(quote, initialMcpSelectedOperationIds(run.plan));
  return selectedPrice ? { available: true, priceSnapshot: selectedPrice } : { available: false, reason: "quote_mismatch" };
}

export function shouldPollMcpApproval(run: AgentPlanRun | null | undefined): boolean {
  if (!run) return false;
  const settlement = run.mcp_settlement;
  return shouldPollAgentPlan(run.status)
    || settlement?.forward_status === "UNKNOWN"
    || ["RESERVED", "EXECUTING", "PENDING_RECONCILIATION"].includes(settlement?.settlement_status ?? "");
}

export function canCancelMcpRun(status: string | undefined): boolean {
  return ["executing", "verifying", "cancel_requested", "rolling_back", "rollback_failed", "halted"].includes(status ?? "");
}

export function mcpDecisionErrorKey(error: unknown): "credit" | "conflict" | "forbidden" | "missing" | "price" | "ambiguous" | "failed" {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (status === 402) return "credit";
  if (status === 409) return "conflict";
  if (status === 403) return "forbidden";
  if (status === 404) return "missing";
  if (status === 503 && code === "MCP_PRICE_UNCONFIGURED") return "price";
  if (status >= 500 || status === 0) return "ambiguous";
  return "failed";
}
