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
  children: PlanPreviewNode[];
};

/** 서버 트리를 복사한 뒤 계획 순서대로 적용해 변경 관련 가지를 보여준다. */
export function buildPlanPreviewTree(plan: AgentPlan, tree: PlanTreeItem[]) {
  const nodes = new Map<string, PlanPreviewNode>();
  const parents = new Map<string, string | null>();
  const changed = new Set<string>();
  const created = new Map<string, string>();
  function visit(items: PlanTreeItem[], parent: string | null) {
    for (const item of items) {
      nodes.set(item.id, { id: item.id, name: item.name.normalize("NFC"), folder: item.type === "folder" || item.children !== undefined, isNew: false, children: [] });
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
    const args = operation.arguments;
    const isCreate = operation.tool_name === "create_folder" || operation.tool_name === "create_document";
    const id = isCreate ? `operation:${operation.id}` : operation.target_id;
    if (!id) continue;
    const folder = operation.tool_name.endsWith("folder");
    if (isCreate) {
      created.set(operation.id, id);
      nodes.set(id, { id, name: String(args.name ?? args.display_name ?? "").normalize("NFC"), folder, isNew: true, children: [] });
    }
    const node = nodes.get(id);
    if (!node) continue;
    changed.add(id);
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
  for (const operation of plan.operations) counts[operation.tool_name] = (counts[operation.tool_name] ?? 0) + 1;
  const summary = [
    ["create_folder", "폴더", "생성"], ["move_document", "문서", "이동"],
    ["move_folder", "폴더", "이동"], ["rename_folder", "폴더", "이름 변경"],
    ["rename_document", "문서", "이름 변경"], ["create_document", "문서", "생성"],
    ["apply_document_edit", "문서", "편집"]
  ].filter(([tool]) => counts[tool]).map(([tool, label, verb]) => `${label} ${counts[tool]}개 ${verb}`).join(" · ");
  return { nodes: relevant(roots), summary };
}

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

export function agentPlanStatusLabel(status: string | undefined): string {
  const labels: Record<string, string> = {
    queued: "계획 생성 대기", planning: "계획 생성 중", awaiting_approval: "승인 대기",
    executing: "실행 중", verifying: "결과 확인 중", completed: "실행 완료",
    partial_failed: "일부 작업 실패", failed: "실행 실패", conflicted: "변경 충돌",
    rejected: "계획 거절됨", clarification_required: "추가 설명 필요",
    cancel_requested: "취소 요청 중", rolling_back: "변경 복구 중",
    rollback_failed: "변경 복구 실패", cancelled: "취소됨"
  };
  return status ? labels[status] ?? "상태 확인 필요" : "계획 불러오는 중";
}

const DEFAULT_CLARIFICATION_MESSAGE = "원하는 정리 기준을 작업 입력창에 더 구체적으로 알려주세요.";

/** 명확화 요청일 때 카드에 보일 문장. AI가 되물은 질문이 있으면 그 문장을, 없으면 기본 안내를 쓴다. */
export function agentPlanClarificationMessage(run: AgentPlanRun | null | undefined): string | null {
  if (run?.status !== "clarification_required") return null;
  return run.clarification_question?.trim().normalize("NFC") || DEFAULT_CLARIFICATION_MESSAGE;
}

/** 부분 승인에서 고르지 않아 실행하지 않은 작업. 실패가 아니라 제외로 보여 준다. */
export function isOperationNotSelected(operation: Pick<AgentPlanOperation, "status" | "error_code">): boolean {
  return operation.status === "skipped" && operation.error_code === "not_selected";
}

const SUCCEEDED_OPERATION_STATUSES = new Set(["succeeded", "completed"]);
const PENDING_OPERATION_STATUSES = new Set(["pending", "planned"]);

export type PlanOperationResults = {
  /** 실제로 저장(적용)된 작업 */
  applied: number;
  /** 고르지 않았거나 건너뛴 작업(skipped, not_selected 포함) */
  excluded: number;
  /** 실패·충돌·권한 없음 등으로 저장되지 않은 작업 */
  failed: number;
};

/**
 * 실행이 끝난 계획에서 실제로 저장된 작업 수를 센다. 계획 전체 작업 수가 아니라 결과 기준이다.
 * 결과 상태가 하나도 없는 응답(승인 직후 캐시처럼 아직 planned)은 고르지 않은 작업만 빼고 저장으로 본다.
 */
export function summarizePlanOperationResults(operations: ReadonlyArray<Pick<AgentPlanOperation, "status" | "error_code">>): PlanOperationResults {
  const excluded = operations.filter((operation) => operation.status === "skipped").length;
  const hasResults = operations.some((operation) => operation.status !== "skipped" && !PENDING_OPERATION_STATUSES.has(operation.status));
  if (!hasResults) return { applied: operations.length - excluded, excluded, failed: 0 };
  const applied = operations.filter((operation) => SUCCEEDED_OPERATION_STATUSES.has(operation.status)).length;
  return { applied, excluded, failed: operations.length - excluded - applied };
}

/** 실행 실패(run error_code)별 안내. AI는 예외 원문 없이 코드만 내려준다(ai failure_codes). */
const PLAN_FAILURE_MESSAGES: Record<string, string> = {
  plan_out_of_scope: "선택한 폴더 밖으로 옮기거나 선택한 폴더 자체를 바꾸는 작업만 있어 정리 계획을 만들지 못했어요. 규칙을 조정해 다시 시도해 주세요.",
  input_rejected: "AI가 만든 계획이 검증을 통과하지 못해 정리 계획을 만들지 못했어요. 규칙을 조정하거나 다시 시도해 주세요.",
  provider_rate_limited: "AI 요청이 많아 계획을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
  provider_unavailable: "AI 서비스에 연결하지 못해 계획을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
  deadline_exceeded: "계획을 만드는 데 너무 오래 걸려 중단했어요. 다시 시도해 주세요."
};
const PLAN_FAILURE_FALLBACK = "작업을 완료하지 못했습니다. 다시 시도해 주세요.";
const PLAN_EXECUTION_FAILURE_FALLBACK = "작업을 완료하지 못했습니다. 상세 보기에서 항목별 상태를 확인해주세요.";
const FAILED_PLAN_RUN_STATUSES = new Set(["failed", "partial_failed", "conflicted", "rollback_failed"]);

/** 실패한 run이면 카드에 보일 이유, 아니면 null. 알려진 코드는 원인별 문구, 모르는 코드는 기본 안내를 쓴다. */
export function agentPlanFailureMessage(run: Pick<AgentPlanRun, "status" | "error_code" | "plan"> | null | undefined): string | null {
  if (!run || !FAILED_PLAN_RUN_STATUSES.has(run.status)) return null;
  const known = run.error_code ? PLAN_FAILURE_MESSAGES[run.error_code] : undefined;
  if (known) return known;
  // 계획이 있으면 항목별 결과를 상세 보기에서 볼 수 있다.
  return run.plan ? PLAN_EXECUTION_FAILURE_FALLBACK : PLAN_FAILURE_FALLBACK;
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
 */
const PLAN_SUMMARY_NOTE_PATTERNS = [
  /\s*대상 폴더 밖으로 옮기는 작업 \d+개는 계획에서 뺐어요\.?/,
  /\s*대상 폴더 자체는 바꿀 수 없어 그 폴더의 이름 변경·이동 작업 \d+개는 계획에서 뺐어요\./,
  /\s*계획에 없는 문서 중 내용이 거의 같은 문서가 있어요: (?:'[^']*'와\(과\) '[^']*'(?:, )?)+\./,
  /\s*문서 \d+개는 내용 중복을 확인하지 못했어요\./
];

/**
 * 계획 요약을 본문과 안내(범위 밖 제외·대상 폴더 자체 제외·내용 중복)로 나눈다. 안내는 요약이 한 줄로 잘리거나 규칙 텍스트로 가려져도
 * 보이도록 따로 보여 준다. 안내가 여럿이면 요약에 나온 순서대로 이어 붙인다.
 */
export function splitPlanSummary(summary: string | null | undefined): { body: string; scopeNote: string | null } {
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
  return { body: body.trim(), scopeNote };
}

export function canApproveAgentPlan(run: AgentPlanRun | null | undefined): boolean {
  return run?.status === "awaiting_approval" && run.plan?.status === "awaiting_approval";
}

/** 새 폴더 참조도 이름으로 풀어 승인할 이동 경로를 보여준다. */
export function describePlanOperations(plan: AgentPlan, tree: PlanTreeItem[]) {
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
    if (value === null) return "최상위";
    if (typeof value === "string") return paths.get(value) ?? "폴더 이름 확인 불가";
    if (value && typeof value === "object" && "$operation_result" in value) {
      return createdPaths.get(String(value.$operation_result)) ?? "새 폴더 이름 확인 불가";
    }
    return "위치 확인 불가";
  }
  return [...plan.operations].sort((a, b) => a.sequence - b.sequence).map((operation) => {
    const args = operation.arguments;
    const target = paths.get(operation.target_id ?? "") ?? "항목 이름 확인 불가";
    const name = String(args.name ?? args.display_name ?? "");
    const parent = destination(operation.tool_name.endsWith("folder") ? args.parent_folder_id : args.folder_id);
    const createdPath = parent === "최상위" ? name : `${parent} / ${name}`;
    let description: string;
    switch (operation.tool_name) {
      case "create_folder":
        createdPaths.set(operation.id, createdPath);
        description = `폴더 생성: ${createdPath}`;
        break;
      case "move_document":
      case "move_folder": description = `${target} → ${parent}`; break;
      case "rename_folder":
      case "rename_document": description = `이름 변경: ${target} → ${name}`; break;
      case "create_document": description = `문서 생성: ${createdPath}`; break;
      case "apply_document_edit": description = `문서 편집: ${target}`; break;
      default: description = "지원하지 않는 작업";
    }
    return { ...operation, description: description.normalize("NFC") };
  });
}
