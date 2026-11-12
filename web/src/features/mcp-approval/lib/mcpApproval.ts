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
  "move_folder", "move_document", "apply_document_edit", "publish_skill_definition"
]);
const MAX_MCP_OPERATIONS = 20;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKILL_FIELDS = ["skill_id", "expected_version", "scope_type", "name", "description", "instructions_markdown",
  "capabilities", "allowed_tools", "targets", "result_mode", "requires_source"];
const SKILL_CAPABILITIES = new Set(["document-create", "document-edit", "folder-organize", "template"]);
const SKILL_TARGETS = new Set(["current_document", "selection"]);

export type McpSkillDefinition = {
  skill_id: string | null; expected_version: number | null; scope_type: "personal" | "team";
  name: string; description: string; instructions_markdown: string;
  capabilities: string[]; allowed_tools: string[]; targets: string[];
  result_mode: "create" | "edit" | "auto" | null; requires_source: boolean;
};

const strings = (value: unknown, allowed?: Set<string>): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "" && (!allowed || allowed.has(item)));

/**
 * 외부 AI가 제안한 Skill 정의 게시. 서버가 확정해 operation_hash로 묶은 값이라 읽기만 한다.
 * Skill 게시가 아니면 null, 필드·형식·대상 버전이 하나라도 어긋나면 "invalid"(승인 불가).
 */
export function mcpSkillDefinition(operation: AgentPlanOperation): McpSkillDefinition | null | "invalid" {
  if (operation.tool_name !== "publish_skill_definition") return null;
  const args = operation.arguments ?? {};
  const keys = Object.keys(args);
  if (keys.length !== SKILL_FIELDS.length || !SKILL_FIELDS.every((key) => keys.includes(key))) return "invalid";
  const { skill_id: skillId, expected_version: version } = args;
  const create = skillId === null && version === null;
  const update = typeof skillId === "string" && UUID.test(skillId) && Number.isSafeInteger(version) && (version as number) > 0;
  if ((!create && !update) || (operation.target_id ?? null) !== skillId || (operation.base_version ?? null) !== version
    || (operation.depends_on?.length ?? 0) > 0) return "invalid";
  const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
  if (!["personal", "team"].includes(String(args.scope_type)) || !text(args.name) || !text(args.description)
    || !text(args.instructions_markdown) || !strings(args.capabilities, SKILL_CAPABILITIES) || args.capabilities.length < 1
    || !strings(args.allowed_tools) || !strings(args.targets, SKILL_TARGETS)
    || ![null, "create", "edit", "auto"].includes(args.result_mode as string | null) || typeof args.requires_source !== "boolean") return "invalid";
  return args as McpSkillDefinition;
}

/** PDF 변환본 생성이 고정한 원본 문서·hash. 원본 표시가 없으면 null, 한쪽만 있거나 형식이 틀리면 "invalid"(승인 불가). */
export function mcpConvertedSource(operation: AgentPlanOperation): { documentId: string; contentHash: string } | null | "invalid" {
  const args = operation.arguments ?? {};
  if (!("source_document_id" in args) && !("source_content_hash" in args)) return null;
  const { source_document_id: documentId, source_content_hash: contentHash } = args;
  return operation.tool_name === "create_document" && typeof documentId === "string" && documentId.trim()
    && typeof contentHash === "string" && CONTENT_HASH.test(contentHash)
    ? { documentId, contentHash }
    : "invalid";
}

export function mcpApprovalRoute(workspaceId: string, runId: string): string {
  return `/mcp/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}`;
}

export const mcpApprovalQueryKey = (userId: string, workspaceId: string, runId: string) =>
  ["mcpApproval", userId, workspaceId, runId] as const;

export const mcpApprovalSelectionKey = (userId: string, workspaceId: string, runId: string, plan: Pick<AgentPlan, "version" | "operation_hash">) =>
  `${userId}:${workspaceId}:${runId}:${plan.version}:${plan.operation_hash}`;

function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validMcpPriceSnapshot(value: unknown): value is McpPriceSnapshot {
  if (!value || typeof value !== "object") return false;
  const price = value as Partial<McpPriceSnapshot>;
  return validMoney(price.unit_price_minor)
    && validMoney(price.plan_cap_minor)
    // 운영 설정이 문서 작업 승인을 무료(단가·상한 0)로 둘 수 있고, Skill 정의 저장만 고른 계획도 최대 청구액이 0이다.
    && typeof price.maximum_charge_minor === "number" && Number.isSafeInteger(price.maximum_charge_minor) && price.maximum_charge_minor >= 0
    && price.currency === "KRW"
    && typeof price.price_version === "string"
    && price.price_version.trim().length > 0;
}

export type McpApprovalAvailability =
  | { available: true; priceSnapshot: McpPriceSnapshot }
  | { available: false; reason: "not_mcp" | "missing_authority" | "unsupported_plan" | "target_version_changed" | "quote_unavailable" | "quote_mismatch" | "not_approvable" };

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
      || operation.sequence !== index + 1 || sequences.has(operation.sequence)
      || mcpConvertedSource(operation) === "invalid" || mcpSkillDefinition(operation) === "invalid") return false;
    const earlier = new Set(ordered.filter((candidate) => candidate.sequence < operation.sequence).map((candidate) => candidate.id));
    if (operationDependencies(operation).some((id) => !earlier.has(id))) return false;
    ids.add(operation.id);
    sequences.add(operation.sequence);
  }
  // Skill 게시는 다른 작업과 섞지 않는 단일 작업 계획으로만 승인한다.
  return !ordered.some((operation) => operation.tool_name === "publish_skill_definition") || ordered.length === 1;
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

/** Skill 정의 저장은 수수료 대상이 아니다. 나머지 고른 작업 수로 최대 청구액을 계산한다. */
const FREE_MCP_TOOLS = new Set(["publish_skill_definition"]);

export function mcpPriceSnapshotForSelection(quote: McpApprovalQuote, operationIds: readonly string[], plan: AgentPlan): McpPriceSnapshot | null {
  if (!validMcpPriceSnapshot(quote.price_snapshot) || operationIds.length > MAX_MCP_OPERATIONS) return null;
  const { unit_price_minor, plan_cap_minor, currency, price_version } = quote.price_snapshot;
  const selected = new Set(operationIds);
  const billable = plan.operations.filter((operation) => selected.has(operation.id) && !FREE_MCP_TOOLS.has(operation.tool_name)).length;
  if (billable > 0 && unit_price_minor > Number.MAX_SAFE_INTEGER / billable) return null;
  return {
    unit_price_minor,
    plan_cap_minor,
    currency,
    price_version,
    maximum_charge_minor: Math.min(unit_price_minor * billable, plan_cap_minor)
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
  if (quote?.client_name?.trim() && quote.unavailable_reason === "TARGET_VERSION_CHANGED") {
    return { available: false, reason: "target_version_changed" };
  }
  const priceSnapshot = quote?.price_snapshot;
  if (!quote?.client_name?.trim() || !validMcpPriceSnapshot(priceSnapshot)) {
    return { available: false, reason: "quote_unavailable" };
  }
  const selectedOperationCount = quote.selected_operation_count;
  if (typeof selectedOperationCount !== "number" || !Number.isSafeInteger(selectedOperationCount) || selectedOperationCount < 1
    || selectedOperationCount > run.plan.operations.length || selectedOperationCount > MAX_MCP_OPERATIONS) {
    return { available: false, reason: "quote_mismatch" };
  }
  const quotedIds = run.plan.operations.slice(0, selectedOperationCount).map((operation) => operation.id);
  const quotedPrice = mcpPriceSnapshotForSelection(quote, quotedIds, run.plan);
  if (!quotedPrice || quotedPrice.maximum_charge_minor !== priceSnapshot.maximum_charge_minor) {
    return { available: false, reason: "quote_mismatch" };
  }
  const selectedPrice = mcpPriceSnapshotForSelection(quote, initialMcpSelectedOperationIds(run.plan), run.plan);
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

/** 정산 응답에 오는 상태 값. 화면 라벨(mcpApproval.execution 등)도 이 목록을 기준으로 둔다. */
export const MCP_EXECUTION_STATUSES = ["RESERVED", "FORWARDED", "CANCELLED", "HALTED", "PURGED"] as const;
export const MCP_FORWARD_STATUSES = ["NOT_SENT", "UNKNOWN", "ACCEPTED"] as const;
export const MCP_SETTLEMENT_STATUSES = ["RESERVED", "EXECUTING", "PENDING_RECONCILIATION", "SETTLED"] as const;

export type McpRunTone = "pending" | "progress" | "success" | "neutral" | "warning" | "danger";
const RUN_TONES: Record<string, McpRunTone> = {
  queued: "progress", planning: "progress", awaiting_approval: "pending", executing: "progress", verifying: "progress",
  cancel_requested: "progress", rolling_back: "progress", completed: "success", partial_failed: "warning", failed: "danger",
  conflicted: "danger", rollback_failed: "danger", rejected: "neutral", cancelled: "neutral", clarification_required: "warning",
  halted: "warning", invalidated: "warning", expired: "neutral"
};

/** 실행 상태 배지 색. 모르는 상태는 중립색이다(라벨은 agentPlanStatusLabel이 "알 수 없음"으로 쓴다). */
export function mcpRunTone(status: string | undefined): McpRunTone {
  return RUN_TONES[status ?? ""] ?? "neutral";
}

/** 머리말 문장 종류. 모든 작업이 같은 종류면 그 종류로, 섞였으면 작업 수로 말한다. */
export type McpRunHeadline =
  | { kind: "editDocuments" | "createDocuments" | "publishSkill" | "operations" | "unknown"; count: number }
  | { kind: "editDocumentNamed" | "createDocumentNamed"; count: number; name: string; others: number };

/**
 * 머리말 문장. 문서 이름을 알면(편집은 워크스페이스 트리, 생성은 인자) 첫 문서 이름과 나머지 개수로 말한다.
 * 이름을 하나라도 모르면 개수로만 말한다.
 */
export function mcpRunHeadline(
  plan: Pick<AgentPlan, "operations"> | null | undefined,
  documentName: (id: string) => string | undefined = () => undefined
): McpRunHeadline {
  const operations = plan?.operations ?? [];
  if (operations.length === 0) return { kind: "unknown", count: 0 };
  const every = (tool: string) => operations.every((operation) => operation.tool_name === tool);
  const named = (kind: "editDocumentNamed" | "createDocumentNamed", names: (string | undefined)[]): McpRunHeadline | null => {
    const unique = [...new Set(names)];
    if (unique.some((name) => !name?.trim())) return null;
    return { kind, count: operations.length, name: unique[0]!.trim(), others: unique.length - 1 };
  };
  if (every("apply_document_edit")) {
    return named("editDocumentNamed", operations.map((operation) => operation.target_id ? documentName(operation.target_id) : undefined))
      ?? { kind: "editDocuments", count: operations.length };
  }
  if (every("create_document")) {
    return named("createDocumentNamed", operations.map((operation) => {
      const value = operation.arguments?.name ?? operation.arguments?.display_name;
      return typeof value === "string" ? value : undefined;
    })) ?? { kind: "createDocuments", count: operations.length };
  }
  if (every("publish_skill_definition")) return { kind: "publishSkill", count: operations.length };
  return { kind: "operations", count: operations.length };
}

/** 수수료 한 줄의 종류. 정산이 있으면 정산 결과를, 없으면 지금 선택의 최대액(0이면 무료)을 보여 준다. */
export type McpRunCostLine =
  | { kind: "free" }
  | { kind: "maximum"; amount: number }
  | { kind: "reserved"; amount: number }
  | { kind: "reconciling"; amount: number }
  | { kind: "charged"; amount: number };

export function mcpRunCostLine(
  settlement: Pick<NonNullable<AgentPlanRun["mcp_settlement"]>, "settlement_status" | "charged_minor" | "maximum_charge_minor"> | null | undefined,
  priceSnapshot: Pick<McpPriceSnapshot, "maximum_charge_minor"> | null | undefined
): McpRunCostLine | null {
  if (settlement) {
    switch (settlement.settlement_status) {
      case "SETTLED": return { kind: "charged", amount: settlement.charged_minor };
      case "PENDING_RECONCILIATION": return { kind: "reconciling", amount: settlement.maximum_charge_minor };
      default: return settlement.maximum_charge_minor === 0 ? { kind: "free" } : { kind: "reserved", amount: settlement.maximum_charge_minor };
    }
  }
  if (!priceSnapshot) return null;
  return priceSnapshot.maximum_charge_minor === 0 ? { kind: "free" } : { kind: "maximum", amount: priceSnapshot.maximum_charge_minor };
}
