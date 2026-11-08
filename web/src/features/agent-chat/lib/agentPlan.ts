import { isKnownKey, type AgentChatTranslator } from "./agentChatTranslator";

export type AgentPlanOperation = {
  id: string;
  sequence: number;
  tool_name: string;
  target_id: string | null;
  source_parent_id: string | null;
  destination_parent_id: string | null;
  arguments: Record<string, unknown>;
  reason: string;
  status: string;
  /** 실행 실패·제외 사유. 부분 승인에서 고르지 않은 작업은 status "skipped" + "not_selected". */
  error_code?: string | null;
  depends_on?: string[];
  /** 승인 화면 안내용 검토 결과(operation_hash에 포함되지 않음). 옛 계획에는 없다. */
  warning?: AgentPlanOperationWarning | null;
  /** 화면의 기본 선택 여부. 없으면 선택으로 본다. */
  suggested_selected?: boolean;
  /** 영수증으로 확인된 기존 생성 결과 재사용. 새 생성·과금·롤백 대상으로 표시하지 않는다. */
  existing_result?: {
    resource_type: "DOCUMENT" | "FOLDER";
    resource_id: string;
    current_version: number;
  } | null;
};

export type AgentPlanOperationWarning = {
  /** "duplicate_name" | "duplicate_content" | "depends_on_unselected" 등 */
  type: string;
  /** 그대로 보여 줄 한국어 문장 */
  message: string;
};

export type AgentPlan = {
  id: string;
  version: number;
  operation_hash: string;
  summary: string;
  status: string;
  operations: AgentPlanOperation[];
  /** 승인 주체. "user"(직접 승인) 또는 "auto:user-setting"(설정의 자동 승인). 승인 전이거나 옛 응답이면 없다. */
  approved_by?: string | null;
};

export type McpPriceSnapshot = {
  unit_price_minor: number;
  plan_cap_minor: number;
  currency: string;
  price_version: string;
  maximum_charge_minor: number;
};

export type McpApprovalQuote = {
  client_name: string;
  selected_operation_count?: number;
  price_snapshot?: McpPriceSnapshot | null;
  unavailable_reason?: "TARGET_VERSION_CHANGED" | null;
};

export type McpSettlement = {
  approval_id: string;
  execution_status: "RESERVED" | "FORWARDED" | "CANCELLED" | "HALTED" | "PURGED";
  forward_status: "NOT_SENT" | "UNKNOWN" | "ACCEPTED";
  settlement_status: "RESERVED" | "EXECUTING" | "PENDING_RECONCILIATION" | "SETTLED";
  charged_minor: number;
  maximum_charge_minor: number;
  currency: string;
  client_name: string;
  price_snapshot: McpPriceSnapshot;
};

export type AgentPlanRun = {
  id: string;
  status: string;
  error_code: string | null;
  /** 계획을 세우지 못한 이유를 AI가 되묻는 문장. 명확화 요청이 아니거나 옛 AI 응답이면 비어 있다. */
  clarification_question?: string | null;
  /** 사용자가 보낸 원래 요청 요약. 작업 카드 제목에 쓴다. 옛 run에는 없을 수 있다. */
  request_summary?: string | null;
  /** 턴에서 지정한 작업 대상 폴더. 지정하지 않았거나 옛 run이면 비어 있다. */
  target_folder_id?: string | null;
  /** 선택한 스킬의 규칙 요약. 스킬 없이 실행했거나 옛 run이면 비어 있다. */
  rule_summary?: string | null;
  origin?: string | null;
  grant_id?: string | null;
  client_id?: string | null;
  policy_generation?: number | null;
  mcp_approval_quote?: McpApprovalQuote | null;
  mcp_settlement?: McpSettlement | null;
  plan: AgentPlan | null;
};

type PlanTreeItem = {
  id: string;
  name: string;
  type?: "folder" | "document";
  children?: PlanTreeItem[];
};

export type PlanPreviewNode = {
  id: string;
  name: string;
  folder: boolean;
  isNew: boolean;
  /** 이 항목의 작업이 실패했다. 이름·자리는 실제 그대로다. */
  failed: boolean;
  children: PlanPreviewNode[];
};

/**
 * 서버 트리를 복사한 뒤 계획 순서대로 적용해 변경 관련 가지를 보여준다. 실행 결과가 있으면 그대로 따른다:
 * 실패한 작업은 적용하지 않고 항목에 실패로 표시하며, 고르지 않은 작업은 뺀다.
 */
export function buildPlanPreviewTree(plan: AgentPlan, tree: PlanTreeItem[], t: AgentChatTranslator) {
  const nodes = new Map<string, PlanPreviewNode>();
  const parents = new Map<string, string | null>();
  const changed = new Set<string>();
  const created = new Map<string, string>();
  function visit(items: PlanTreeItem[], parent: string | null) {
    for (const item of items) {
      nodes.set(item.id, { id: item.id, name: item.name.normalize("NFC"), folder: item.type === "folder" || item.children !== undefined, isNew: false, failed: false, children: [] });
      parents.set(item.id, parent);
      visit(item.children ?? [], item.id);
    }
  }
  visit(tree, null);
  function parentId(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "$operation_result" in value) {
      return created.get(String(value.$operation_result)) ?? null;
    }
    return null;
  }
  for (const operation of [...plan.operations].sort((a, b) => a.sequence - b.sequence)) {
    const outcome = planOperationOutcome(operation);
    // 되돌린 작업은 지금 트리에 남아 있지 않다.
    if (outcome === "excluded" || outcome === "rolled_back") continue;
    const isFailed = outcome === "failed";
    const args = operation.arguments;
    const isCreate = operation.tool_name === "create_folder" || operation.tool_name === "create_document";
    const id = isCreate ? `operation:${operation.id}` : operation.target_id;
    if (!id) continue;
    const folder = operation.tool_name.endsWith("folder");
    if (isCreate) {
      created.set(operation.id, id);
      nodes.set(id, { id, name: String(args.name ?? args.display_name ?? "").normalize("NFC"), folder, isNew: !isFailed, failed: false, children: [] });
    }
    const node = nodes.get(id);
    if (!node) continue;
    changed.add(id);
    if (isFailed) {
      node.failed = true;
      if (!isCreate) continue;
    }
    if (isCreate || operation.tool_name.startsWith("move_")) {
      parents.set(id, parentId(folder ? args.parent_folder_id : args.folder_id));
    }
    if (operation.tool_name.startsWith("rename_")) node.name = String(args.name ?? args.display_name ?? "").normalize("NFC");
  }
  const roots: PlanPreviewNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(parents.get(node.id) ?? "");
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  function relevant(items: PlanPreviewNode[]): PlanPreviewNode[] {
    return items.flatMap((node) => {
      const children = relevant(node.children);
      return changed.has(node.id) || children.length ? [{ ...node, children }] : [];
    }).sort((a, b) => Number(b.folder) - Number(a.folder));
  }
  const counts: Record<string, number> = {};
  let failedCount = 0;
  let rolledBackCount = 0;
  let unrecoverableCount = 0;
  for (const operation of plan.operations) {
    const outcome = planOperationOutcome(operation);
    if (outcome === "failed") failedCount += 1;
    else if (outcome === "rolled_back") rolledBackCount += 1;
    else if (operation.error_code === ROLLBACK_DOCUMENT_PURGED) unrecoverableCount += 1;
    else if (outcome !== "excluded") counts[operation.tool_name] = (counts[operation.tool_name] ?? 0) + 1;
  }
  const summary = SUMMARY_TOOLS.filter((tool) => counts[tool]).map((tool) => t(`plan.summary.${tool}`, { count: counts[tool] }));
  if (rolledBackCount > 0) summary.push(t("plan.summary.rolledBack", { count: rolledBackCount }));
  if (unrecoverableCount > 0) summary.push(t("plan.summary.unrecoverable", { count: unrecoverableCount }));
  if (failedCount > 0) summary.push(t("plan.summary.failed", { count: failedCount }));
  return { nodes: relevant(roots), summary: summary.join(" · ") };
}

/** 계획 미리 보기 요약에 세어 보여 주는 작업 종류(순서대로) */
const SUMMARY_TOOLS = ["create_folder", "move_document", "move_folder", "rename_folder", "rename_document", "create_document", "apply_document_edit"] as const;

export function isWorkspacePlanAction(action: string | undefined): boolean {
  return action === "folder_organize" || action === "workspace_workflow";
}

/** 진행 중인 계획 run·취소 중인 turn을 다시 조회하는 주기 */
export const PLAN_POLL_INTERVAL_MS = 3000;

/**
 * 이미 받은 계획의 run ID. 끝난(completed) turn이 가리키는 run은 바뀌지 않으므로, 다음 폴링은 turn을 다시 묻지 않고
 * 이 run만 조회한다(폴링 한 주기에 요청 하나). turn 취소 상태만 담은 결과(id가 turn ID)나 아직 못 받았으면 null이다.
 */
export function knownPlanRunId(previous: Pick<AgentPlanRun, "id"> | null | undefined, turnId: string): string | null {
  return previous?.id && previous.id !== turnId ? previous.id : null;
}

export function shouldPollAgentPlan(status: string | undefined): boolean {
  return !status || ["queued", "planning", "awaiting_approval", "executing", "verifying", "cancel_requested", "rolling_back"].includes(status);
}

/** 같은 화면에서 진행 중 → 종료 전이를 봤을 때만 참이다. 이미 끝난 계획을 다시 마운트할 때는 거짓. */
export function isPlanRunSettled(previous: string | undefined, next: string | undefined): boolean {
  return previous !== undefined && next !== undefined && shouldPollAgentPlan(previous) && !shouldPollAgentPlan(next);
}

/**
 * 이 세션에서 직접 시작한 계획(작업 요청·수락). 자동 승인이면 첫 조회 전에 끝나 진행 중 → 종료 전이를 못 볼 수 있어,
 * 종료를 처음 본 순간 한 번만 끝난 것으로 친다. 지난 계획이 다시 마운트될 때는 여기 없어 다시 받지 않는다(#66).
 */
export function createStartedPlanTurns() {
  const turnIds = new Set<string>();
  return {
    mark: (turnId: string) => { turnIds.add(turnId); },
    takeSettled: (turnId: string | null | undefined, status: string | undefined): boolean =>
      Boolean(turnId) && status !== undefined && !shouldPollAgentPlan(status) && turnIds.delete(turnId!)
  };
}

export const startedPlanTurns = createStartedPlanTurns();

/** 상태 문구(agentChat.plan.status)를 둔 run 상태 */
const PLAN_RUN_STATUSES = [
  "queued", "planning", "awaiting_approval", "executing", "verifying", "completed", "partial_failed", "failed", "conflicted",
  "rejected", "clarification_required", "cancel_requested", "rolling_back", "rollback_failed", "cancelled", "halted", "invalidated", "expired"
] as const;

export function agentPlanStatusLabel(status: string | undefined, t: AgentChatTranslator): string {
  if (!status) return t("plan.statusLoading");
  return isKnownKey(PLAN_RUN_STATUSES, status) ? t(`plan.status.${status}`) : t("plan.statusUnknown");
}

/** 명확화 요청일 때 카드에 보일 문장. AI가 되물은 질문이 있으면 그 문장을, 없으면 기본 안내를 쓴다. */
export function agentPlanClarificationMessage(run: AgentPlanRun | null | undefined, t: AgentChatTranslator): string | null {
  if (run?.status !== "clarification_required") return null;
  return run.clarification_question?.trim().normalize("NFC") || t("plan.clarificationDefault");
}

/** 부분 승인에서 고르지 않아 실행하지 않은 작업. 실패가 아니라 제외로 보여 준다. */
export function isOperationNotSelected(operation: Pick<AgentPlanOperation, "status" | "error_code">): boolean {
  return operation.status === "skipped" && operation.error_code === "not_selected";
}

/** 영구 삭제된 문서가 있어 일부만 되돌린 run의 실패 코드(ai ROLLBACK_DOCUMENT_PURGED). */
const ROLLBACK_DOCUMENT_PURGED = "rollback_document_purged";

/**
 * 문서를 영구 삭제해 실행하거나 되돌릴 수 없는 작업. 승인 전 삭제면 AI가 건너뛰고(ai document_purged),
 * 실행 뒤 삭제면 withRollbackPurgedOperations가 표시한다. 고를 수 없다.
 */
export function isOperationPurged(operation: Pick<AgentPlanOperation, "status" | "error_code">): boolean {
  return operation.status === "skipped" && (operation.error_code === "document_purged" || operation.error_code === ROLLBACK_DOCUMENT_PURGED);
}

const SUCCEEDED_OPERATION_STATUSES = new Set(["succeeded", "completed"]);
const PENDING_OPERATION_STATUSES = new Set(["pending", "planned"]);
/** 앞선 작업이 실패해 건너뛴 작업(ai agent_worker). 고르지 않은 것과 달리 실패다. */
const DEPENDENCY_FAILED_ERROR_CODE = "dependency_failed";
const FAILED_OPERATION_STATUSES = new Set(["failed", "forbidden", "conflicted", "verification_failed", "cancelled"]);
const ROLLED_BACK_STATUS = "rolled_back";

export type PlanOperationOutcome = "pending" | "applied" | "excluded" | "failed" | "rolled_back";

/** 작업의 실행 결과. 저장 안 된 실패(권한·충돌 등), 고르지 않은 제외, 실행한 뒤 되돌린 복구를 나눈다. */
export function planOperationOutcome({ status, error_code }: Pick<AgentPlanOperation, "status" | "error_code">): PlanOperationOutcome {
  if (status === "skipped") return error_code === DEPENDENCY_FAILED_ERROR_CODE ? "failed" : "excluded";
  if (status === ROLLED_BACK_STATUS) return "rolled_back";
  if (SUCCEEDED_OPERATION_STATUSES.has(status)) return "applied";
  return FAILED_OPERATION_STATUSES.has(status) ? "failed" : "pending";
}

/** 상태별 실패 이유 문구(agentChat.plan.operationReason)를 둔 작업 상태 */
const OPERATION_FAILURE_REASON_STATUSES = ["forbidden", "conflicted", "skipped", "verification_failed", "cancelled", "rolled_back"] as const;

/** 실패한 작업의 이유 문장 */
export function planOperationFailureReason(operation: Pick<AgentPlanOperation, "status" | "error_code">, t: AgentChatTranslator): string {
  const byCode = agentPlanOperationFailureMessage(operation, t);
  if (byCode) return byCode;
  return isKnownKey(OPERATION_FAILURE_REASON_STATUSES, operation.status) ? t(`plan.operationReason.${operation.status}`) : t("plan.operationReason.fallback");
}

export type PlanOperationResults = {
  /** 실제로 저장(적용)된 작업 */
  applied: number;
  /** 고르지 않은 작업(skipped·not_selected). 앞선 실패로 건너뛴 작업은 failed로 센다. */
  excluded: number;
  /** 실패·충돌·권한 없음 등으로 저장되지 않은 작업 */
  failed: number;
  /** 실행한 뒤 되돌린 작업 */
  rolledBack: number;
};

/**
 * 실행이 끝난 계획에서 실제로 저장된 작업 수를 센다. 계획 전체 작업 수가 아니라 결과 기준이다.
 * 결과 상태가 하나도 없는 응답(승인 직후 캐시처럼 아직 planned)은 고르지 않은 작업만 빼고 저장으로 본다.
 */
export function summarizePlanOperationResults(operations: ReadonlyArray<Pick<AgentPlanOperation, "status" | "error_code">>): PlanOperationResults {
  const excluded = operations.filter((operation) => planOperationOutcome(operation) === "excluded").length;
  const hasResults = operations.some((operation) => planOperationOutcome(operation) !== "excluded" && !PENDING_OPERATION_STATUSES.has(operation.status));
  if (!hasResults) return { applied: operations.length - excluded, excluded, failed: 0, rolledBack: 0 };
  const applied = operations.filter((operation) => SUCCEEDED_OPERATION_STATUSES.has(operation.status)).length;
  const rolledBack = operations.filter((operation) => operation.status === ROLLED_BACK_STATUS).length;
  return { applied, excluded, failed: operations.length - excluded - applied - rolledBack, rolledBack };
}

/**
 * 영구 삭제로 일부만 되돌린 run의 작업을 표시용으로 고친다. AI는 영구 삭제된 문서의 작업을 되돌리지 않고 넘어가 상태가 실행 성공으로 남고,
 * 나머지는 모두 복구(rolled_back)되거나 실패로 남는다. 이 run에서 성공으로 남은 작업은 그래서 영구 삭제된 문서의 작업이다(ai rollback_agent_run).
 */
export function withRollbackPurgedOperations<T extends Pick<AgentPlanRun, "status" | "error_code" | "plan">>(run: T): T {
  if (run.status !== "rollback_failed" || run.error_code !== ROLLBACK_DOCUMENT_PURGED || !run.plan) return run;
  return {
    ...run,
    plan: {
      ...run.plan,
      operations: run.plan.operations.map((operation) => SUCCEEDED_OPERATION_STATUSES.has(operation.status)
        ? { ...operation, status: "skipped", error_code: ROLLBACK_DOCUMENT_PURGED }
        : operation)
    }
  };
}

/** 계획이 실제로 본문을 저장한 문서. 되돌렸거나 실패·제외한 작업은 넣지 않는다. */
export function savedEditDocumentIds(plan: Pick<AgentPlan, "operations"> | null | undefined): string[] {
  const saved = (plan?.operations ?? []).filter((operation) => operation.tool_name === "apply_document_edit" && SUCCEEDED_OPERATION_STATUSES.has(operation.status));
  return [...new Set(saved.flatMap((operation) => {
    const documentId = operation.arguments.document_id ?? operation.target_id;
    return typeof documentId === "string" ? [documentId] : [];
  }))];
}

/** 상태 칩 문구(agentChat.plan.operationStatus)를 둔 작업 상태 */
const OPERATION_STATUSES = ["succeeded", "completed", "running", "failed", "skipped", "forbidden", "conflicted", "verification_failed", "cancelled", "rolled_back", "unknown", "pending_reconciliation"] as const;

export function planOperationStatusLabel(status: string, t: AgentChatTranslator): string {
  return isKnownKey(OPERATION_STATUSES, status) ? t(`plan.operationStatus.${status}`) : t("plan.statusUnknown");
}

/** 작업 결과 칩 문구. 건너뛴 작업은 이유에 따라 나눠 적는다. */
export function planOperationResultLabel(operation: Pick<AgentPlanOperation, "status" | "error_code">, t: AgentChatTranslator): string {
  if (isOperationNotSelected(operation)) return t("plan.excluded");
  if (isOperationPurged(operation)) return t("plan.purged");
  return planOperationStatusLabel(operation.status, t);
}

/** 원인별 안내(agentChat.plan.failure)를 둔 실행 실패 코드(run error_code). AI는 예외 원문 없이 코드만 내려준다(ai failure_codes). */
const PLAN_FAILURE_CODES = ["plan_out_of_scope", "input_rejected", "provider_rate_limited", "provider_unavailable", "deadline_exceeded", ROLLBACK_DOCUMENT_PURGED] as const;
const FAILED_PLAN_RUN_STATUSES = new Set(["failed", "partial_failed", "conflicted", "rollback_failed"]);

/**
 * 실패한 run의 안내 종류. code: 원인별 문구, fallback: 계획을 세우지 못함, partial: 일부 실행 실패, execution: 실행 실패.
 * 문서 수정 계획처럼 원인을 모르는 실패를 따로 풀어 쓰는 화면이 종류로 나눈다. 실패가 아니면 null.
 */
export function agentPlanFailureKind(run: Pick<AgentPlanRun, "status" | "error_code" | "plan"> | null | undefined): "code" | "fallback" | "partial" | "execution" | null {
  if (!run || !FAILED_PLAN_RUN_STATUSES.has(run.status)) return null;
  if (isKnownKey(PLAN_FAILURE_CODES, run.error_code)) return "code";
  if (!run.plan) return "fallback";
  return run.status === "partial_failed" ? "partial" : "execution";
}

/** 실패한 run이면 카드에 보일 이유, 아니면 null. 알려진 코드는 원인별 문구, 모르는 코드는 기본 안내를 쓴다. */
export function agentPlanFailureMessage(run: Pick<AgentPlanRun, "status" | "error_code" | "plan"> | null | undefined, t: AgentChatTranslator): string | null {
  const kind = agentPlanFailureKind(run);
  if (kind === "code" && isKnownKey(PLAN_FAILURE_CODES, run?.error_code)) return t(`plan.failure.${run.error_code}`);
  if (kind === "fallback") return t("plan.failure.fallback");
  // 카드와 미리보기가 함께 쓴다. 항목별 결과는 두 화면 모두 바로 볼 수 있어 위치를 가리키지 않는다.
  if (kind === "partial") return t("plan.failure.partial");
  return kind === "execution" ? t("plan.failure.execution") : null;
}

/**
 * 계획을 세우는 단계에서 실패해 실행된 작업이 없는 run인지. 같은 요청을 다시 보내도 중복 변경이 생기지 않아
 * "다시 시도"를 보여 준다. 일부 실행 뒤 실패(partial_failed 등)는 다시 보내면 이미 옮긴 항목이 또 바뀔 수 있어 제외한다.
 */
export function canRetryAgentPlanRun(run: Pick<AgentPlanRun, "status" | "plan"> | null | undefined): boolean {
  return run?.status === "failed" && !run.plan;
}

/**
 * AI가 요약 끝에 붙이는 고정 안내 문장(ai folder_organize).
 * - 대상 폴더 밖 작업을 계획에서 뺐을 때
 * - 대상 폴더 자체의 이름 변경·이동 작업을 계획에서 뺐을 때
 * - 계획에 없는 문서끼리 본문이 거의 같을 때. 이름에 `.`이 들어갈 수 있어 따옴표 쌍 기준으로 맞춘다.
 * - 본문 중복을 확인하지 못한 문서가 있을 때
 * 영어로 요청한 계획(response_language=en)은 같은 안내를 영어 고정 문장으로 붙인다(ai *_NOTE_EN).
 */
const PLAN_SUMMARY_NOTE_PATTERNS = [
  /\s*대상 폴더 밖으로 옮기는 작업 \d+개는 계획에서 뺐어요\.?/,
  /\s*대상 폴더 자체는 바꿀 수 없어 그 폴더의 이름 변경·이동 작업 \d+개는 계획에서 뺐어요\./,
  /\s*계획에 없는 문서 중 내용이 거의 같은 문서가 있어요: (?:'[^']*'와\(과\) '[^']*'(?:, )?)+\./,
  /\s*문서 \d+개는 내용 중복을 확인하지 못했어요\./,
  /\s*Removed \d+ operations that move items outside the target folder from the plan\.?/,
  /\s*Removed \d+ rename or move operations on the target folder itself from the plan because the target folder can['’]t be changed\./,
  /\s*Some documents not in the plan have nearly identical content: (?:'[^']*' and '[^']*'(?:, )?)+\./,
  /\s*Couldn['’]t check \d+ documents for duplicate content\./
];

/** 이미 실행을 시작한 run. AI가 승인 전에 쓴 요약의 "아직 변경된 사항은 없으며"가 더는 맞지 않다. */
const EXECUTED_RUN_STATUSES = new Set(["executing", "verifying", "completed", "partial_failed", "failed", "conflicted", "rolling_back", "rollback_failed"]);
const NOTHING_CHANGED_YET_SENTENCE = /아직\s*(?:변경|적용|실행|저장|이동)[^.!?]*(?:없|않)|\bnothing has (?:changed|been (?:changed|applied|saved|moved)) yet\b/i;

function dropNothingChangedYet(text: string): string {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => !NOTHING_CHANGED_YET_SENTENCE.test(sentence)).join(" ");
}

/**
 * 계획 요약을 본문과 안내(범위 밖 제외·대상 폴더 자체 제외·내용 중복)로 나눈다. 안내는 요약이 한 줄로 잘리거나 규칙 텍스트로 가려져도
 * 보이도록 따로 보여 준다. 안내가 여럿이면 요약에 나온 순서대로 이어 붙인다.
 * runStatus를 넘기면 실행을 시작한 뒤에는 "아직 변경된 사항은 없으며" 같은 승인 전 문장을 본문에서 뺀다.
 */
export function splitPlanSummary(summary: string | null | undefined, runStatus?: string): { body: string; scopeNote: string | null } {
  const text = (summary ?? "").normalize("NFC");
  let body = text;
  const notes: { index: number; text: string }[] = [];
  for (const pattern of PLAN_SUMMARY_NOTE_PATTERNS) {
    const match = pattern.exec(body);
    if (!match) continue;
    notes.push({ index: text.indexOf(match[0]), text: match[0].trim() });
    body = body.slice(0, match.index) + body.slice(match.index + match[0].length);
  }
  const scopeNote = notes.sort((a, b) => a.index - b.index).map((note) => note.text).join(" ") || null;
  const trimmed = body.trim();
  return { body: runStatus && EXECUTED_RUN_STATUSES.has(runStatus) ? dropNothingChangedYet(trimmed) : trimmed, scopeNote };
}

/** 사용자의 자동 승인 설정에 따라 서버가 확인 없이 승인한 계획의 승인 주체 */
export const AUTO_APPROVED_BY = "auto:user-setting";

export function isAutoApprovedPlan(run: Pick<AgentPlanRun, "plan"> | null | undefined): boolean {
  return run?.plan?.approved_by === AUTO_APPROVED_BY;
}

/**
 * 자동 승인으로 실행한 계획에 보일 안내. 계획에 든 작업 종류별로 되돌리는 방법을 덧붙인다.
 * 자동 승인 대상은 서버가 편집·생성·이동·이름 변경으로 제한하므로 모두 되돌릴 수 있다.
 */
export function autoApprovedPlanNote(plan: Pick<AgentPlan, "operations">, t: AgentChatTranslator): string {
  const tools = new Set(plan.operations.map((operation) => operation.tool_name));
  const hints = [
    tools.has("apply_document_edit") && t("plan.autoApproved.editHint"),
    tools.has("create_document") && t("plan.autoApproved.createHint"),
    [...tools].some((tool) => tool.startsWith("move_") || tool.startsWith("rename_") || tool === "create_folder")
      && t("plan.autoApproved.moveHint")
  ].filter(Boolean);
  return [t("plan.autoApproved.prefix"), ...hints].join(" ");
}

export function canApproveAgentPlan(run: AgentPlanRun | null | undefined): boolean {
  return run?.status === "awaiting_approval" && run.plan?.status === "awaiting_approval";
}

/** 새 폴더 참조도 이름으로 풀어 승인할 이동 경로를 보여준다. */
export function describePlanOperations(plan: AgentPlan, tree: PlanTreeItem[], t: AgentChatTranslator) {
  const paths = new Map<string, string>();
  function visit(items: PlanTreeItem[], parent: string) {
    for (const item of items) {
      const path = parent ? `${parent} / ${item.name}` : item.name;
      paths.set(item.id, path);
      visit(item.children ?? [], path);
    }
  }
  visit(tree, "");
  const createdPaths = new Map<string, string>();
  function destination(value: unknown): string {
    if (value === null) return t("plan.describe.root");
    if (typeof value === "string") return paths.get(value) ?? t("plan.describe.unknownFolder");
    if (value && typeof value === "object" && "$operation_result" in value) {
      return createdPaths.get(String(value.$operation_result)) ?? t("plan.describe.unknownNewFolder");
    }
    return t("plan.describe.unknownLocation");
  }
  return [...plan.operations].sort((a, b) => a.sequence - b.sequence).map((operation) => {
    const args = operation.arguments;
    const target = paths.get(operation.target_id ?? "") ?? t("plan.describe.unknownItem");
    const name = String(args.name ?? args.display_name ?? "");
    const parentValue = operation.tool_name.endsWith("folder") ? args.parent_folder_id : args.folder_id;
    const parent = destination(parentValue);
    const createdPath = parentValue === null ? name : `${parent} / ${name}`;
    let description: string;
    switch (operation.tool_name) {
      case "create_folder":
        createdPaths.set(operation.id, createdPath);
        description = t("plan.describe.createFolder", { path: createdPath });
        break;
      case "move_document":
      case "move_folder": description = `${target} → ${parent}`; break;
      case "rename_folder":
      case "rename_document": description = t("plan.describe.rename", { target, name }); break;
      case "create_document": description = t("plan.describe.createDocument", { path: createdPath }); break;
      case "apply_document_edit": description = t("plan.describe.editDocument", { target }); break;
      default: description = t("plan.describe.unsupported");
    }
    return { ...operation, description: description.normalize("NFC") };
  });
}

// 항목별 error_code는 AgentRun API가 그대로 전달한다. 예외 원문이나 내부 식별자는 화면에 노출하지 않는다.
/** 코드별 안내(agentChat.plan.operationError)를 둔 작업 실패 코드 */
const OPERATION_FAILURE_CODES = [
  "tool_http_403", "tool_http_404", "tool_http_409", "tool_http_423", "tool_http_unavailable", "dependency_failed",
  "unresolved_dependency", "rollback_snapshot_invalid", "state_mismatch", "document_purged"
] as const;
const OPERATION_FAILURE_STATUSES = new Set(["failed", "forbidden", "conflicted", "verification_failed", "skipped"]);

function agentPlanOperationFailureMessage(operation: Pick<AgentPlanOperation, "status" | "error_code">, t: AgentChatTranslator): string | null {
  if (!OPERATION_FAILURE_STATUSES.has(operation.status) || isOperationNotSelected(operation)) return null;
  const code = operation.error_code ?? "";
  if (isKnownKey(OPERATION_FAILURE_CODES, code)) return t(`plan.operationError.${code}`);
  if (/^tool_http_\d{3}$/.test(code)) return t("plan.operationError.toolHttpOther");
  return null;
}
