import {
  agentPlanFailureMessage,
  isOperationNotSelected,
  isOperationPurged,
  PLAN_EXECUTION_FAILURE_FALLBACK,
  PLAN_FAILURE_FALLBACK,
  PLAN_PARTIAL_FAILURE_MESSAGE,
  planOperationStatusLabel,
  type AgentPlan,
  type AgentPlanOperation,
  type AgentPlanRun
} from "./agentPlan";
import type { AgentDocumentEditHunk, AgentRunEditPreviews } from "./documentEditPreviews";
import { canApplyFolderOrganizeSelection, folderOrganizeApproval, type FolderOrganizeApproval, type FolderOrganizeRow } from "./folderOrganize";

export type DocumentEditRow = {
  /** 문서 id(buildFolderOrganizeView의 줄 id). 선택 해제 저장소의 키다. */
  id: string;
  operationIds: string[];
  /** 트리 경로 제목. 트리에 없으면 미리 보기의 현재 제목 */
  title: string;
  summary: string;
  addedLines: number;
  removedLines: number;
  /** 서버 hunk. 미리 보기가 없으면 null */
  hunks: AgentDocumentEditHunk[] | null;
  /** 계획이 작업에 붙인 경고 문장 */
  warning: string | null;
  /** 실행 결과 문구. 아직 실행 전이면 null */
  resultLabel: string | null;
  isFailure: boolean;
  excluded: boolean;
  /** 대상 문서가 영구 삭제돼 고를 수 없고 변경 내용도 없다. */
  isPurged: boolean;
};

const DOCUMENT_PURGED_LABEL = "영구 삭제된 문서라 실행하지 않았어요.";
/** 영구 삭제로 변경 내용이 지워진 문서 줄의 안내 */
export const PURGED_DIFF_NOTE = "문서가 영구 삭제되어 변경 내용을 볼 수 없어요.";

/** AI 계약의 작업 결과 코드별 문구(ai tool_http_*, document_purged). */
const OPERATION_ERROR_LABELS: Record<string, string> = {
  tool_http_423: "다른 사람이 편집 중이라 저장하지 못했어요.",
  tool_http_404: "문서를 찾을 수 없어요.",
  document_purged: DOCUMENT_PURGED_LABEL
};
const CONFLICTED_LABEL = "문서가 바뀌어 저장하지 못했어요. 다시 요청해 주세요.";
const FAILED_OPERATION_STATUSES: ReadonlySet<string> = new Set(["failed", "conflicted", "forbidden", "verification_failed"]);
const SAVED_OPERATION_STATUSES: ReadonlySet<string> = new Set(["succeeded", "completed"]);

/** AI가 계획 없는 기본 문장으로 내려 주는 결과 메시지(ai WORKFLOW_DEFAULT_MESSAGE). 카드가 이미 계획을 보여 줘 안내로 되풀이하지 않는다. */
const WORKFLOW_DEFAULT_MESSAGE = "작업 계획을 만들었습니다. 미리보기에서 확인해 주세요.";

/** 모든 작업이 문서 편집인 계획만 문서별 변경 화면으로 보여 준다. 다른 작업이 섞이면 기존 폴더 트리 화면이다. */
export function isDocumentEditPlan(plan: Pick<AgentPlan, "operations"> | null | undefined): boolean {
  return Boolean(plan && plan.operations.length > 0 && plan.operations.every((operation) => operation.tool_name === "apply_document_edit"));
}

/** 문서 줄에 보일 실행 결과. 실행 전이면 null. */
export function documentEditOperationLabel(operation: Pick<AgentPlanOperation, "status" | "error_code">): string | null {
  if (operation.status === "planned" || operation.status === "pending") return null;
  if (isOperationNotSelected(operation)) return "제외됨";
  const known = operation.error_code ? OPERATION_ERROR_LABELS[operation.error_code] : undefined;
  if (known) return known;
  if (operation.status === "conflicted") return CONFLICTED_LABEL;
  return planOperationStatusLabel(operation.status);
}

type PlanTreeItem = { id: string; name: string; children?: PlanTreeItem[] };

function treePaths(tree: readonly PlanTreeItem[]): Map<string, string> {
  const paths = new Map<string, string>();
  function visit(items: readonly PlanTreeItem[], parent: string) {
    for (const item of items) {
      const name = item.name.normalize("NFC");
      const path = parent ? `${parent} / ${name}` : name;
      paths.set(item.id, path);
      visit(item.children ?? [], path);
    }
  }
  visit(tree, "");
  return paths;
}

/** 계획의 줄(buildFolderOrganizeView)에 트리 경로·미리 보기·실행 결과를 붙인다. */
export function buildDocumentEditRows(
  plan: Pick<AgentPlan, "operations">,
  rows: readonly FolderOrganizeRow[],
  previews: AgentRunEditPreviews | null | undefined,
  tree: readonly PlanTreeItem[]
): DocumentEditRow[] {
  const operations = new Map(plan.operations.map((operation) => [operation.id, operation]));
  const previewByOperation = new Map((previews?.items ?? []).map((item) => [item.operation_id, item]));
  const paths = treePaths(tree);
  return rows.map((row) => {
    const rowOperations = row.operationIds.flatMap((id) => operations.get(id) ?? []);
    const preview = row.operationIds.map((id) => previewByOperation.get(id)).find(Boolean);
    // 결과가 갈리면 실패한 작업을 보여 준다.
    const shown = rowOperations.find((operation) => FAILED_OPERATION_STATUSES.has(operation.status)) ?? rowOperations[0];
    return {
      id: row.id,
      operationIds: row.operationIds,
      title: paths.get(row.id) ?? (preview?.display_name.normalize("NFC") || row.originalName),
      // 영구 삭제된 줄은 결과 문구가 이유를 말하고, AI가 바꾼 reason은 같은 말이다.
      summary: row.isPurged ? "" : (preview?.summary.trim() || row.reason).normalize("NFC"),
      addedLines: preview?.added_lines ?? 0,
      removedLines: preview?.removed_lines ?? 0,
      hunks: preview?.hunks ?? null,
      warning: rowOperations.find((operation) => operation.warning)?.warning?.message.trim().normalize("NFC") || null,
      resultLabel: shown ? documentEditOperationLabel(shown) : null,
      isFailure: shown ? FAILED_OPERATION_STATUSES.has(shown.status) : false,
      excluded: row.excluded || row.isPurged,
      isPurged: row.isPurged
    };
  });
}

/** 수락 전 안내. 고른 수를 따라 바뀌므로 계획 요약을 그대로 쓰지 않는다. */
export function documentEditDecisionNote(selectedCount: number): string {
  return selectedCount > 0 ? `아직 바꾸지 않았습니다. 승인하면 문서 ${selectedCount}개를 수정합니다.` : "아직 바꾸지 않았습니다.";
}

/** 승인하면 실제로 수정될 문서 수. selectedCount는 막힌 문서를 뺀 수(documentEditApproval)이고, 변경안이 만료됐으면 수락할 수 없어 없는 것으로 친다. */
export function documentEditRunnableCount({ selectedCount, isExpired }: { selectedCount: number; isExpired: boolean }): number {
  return isExpired ? 0 : selectedCount;
}

/** 작업이 모두 권한으로 막혀 고를 수 없는 문서 줄. 일부만 막힌 줄은 나머지 작업을 실행할 수 있어 넣지 않는다. */
export function blockedEditRowIds(rows: readonly Pick<FolderOrganizeRow, "id" | "operationIds">[], blockedOperationIds: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(rows.filter((row) => row.operationIds.length > 0 && row.operationIds.every((id) => blockedOperationIds.has(id))).map((row) => row.id));
}

/**
 * 문서 수정 계획의 승인 요청. 막힌 작업을 빼서 카드가 말하는 수정 문서 수와 서버에 보내는 operation_ids를 맞춘다.
 * 막힌 작업에 기대는 작업도 blockedOperationIds에 들어 있어(checkPlanAccess) 빼도 의존 관계가 깨지지 않는다.
 */
export function documentEditApproval(
  plan: AgentPlan,
  rows: FolderOrganizeRow[],
  deselectedIds: ReadonlySet<string>,
  blockedOperationIds: ReadonlySet<string>
): FolderOrganizeApproval {
  const approval = folderOrganizeApproval(plan, rows, new Set([...deselectedIds, ...blockedEditRowIds(rows, blockedOperationIds)]));
  if (blockedOperationIds.size === 0) return approval;
  const operationIds = (approval.operationIds ?? plan.operations.map((operation) => operation.id)).filter((id) => !blockedOperationIds.has(id));
  return { ...approval, operationIds, canApply: canApplyFolderOrganizeSelection(approval.selectedCount, operationIds) };
}

/**
 * 수락 버튼 위 안내. 모두 고르면 null. purgedCount: 영구 삭제로 빠진 문서 수, blockedCount: 권한으로 막혀 빠진 문서 수.
 * 둘 다 사용자가 뺀 문서로 세지 않는다(그 줄이 이유를 말한다). 모두 막혔으면 권한 안내가 이유를 말하므로 null이다.
 */
export function documentEditApprovalHint({ selectedCount, excludedCount, canApply }: Pick<FolderOrganizeApproval, "selectedCount" | "excludedCount" | "canApply">, purgedCount = 0, blockedCount = 0): string | null {
  const userExcluded = excludedCount - purgedCount - blockedCount;
  if (selectedCount === 0 && blockedCount > 0 && userExcluded === 0) return null;
  if (selectedCount === 0) return purgedCount > 0 && userExcluded === 0 ? "수정할 수 있는 문서가 없어요. 대상 문서가 영구 삭제됐어요." : "수정할 문서를 하나 이상 골라 주세요.";
  if (!canApply || userExcluded === 0) return null;
  return `${userExcluded}개는 제외하고 수정해요.`;
}

/**
 * 결과 메시지에서 계획 요약·기본 문장을 뺀 나머지. 보기 권한으로 뺐거나 바뀐 내용이 없어 뺀 문서 안내가 여기 담겨 온다(계약의 "결과 메시지에 안내").
 */
export function documentEditMessageNotice(message: string | null | undefined, planSummary: string | null | undefined): string | null {
  const summary = (planSummary ?? "").trim().normalize("NFC");
  const text = [summary, WORKFLOW_DEFAULT_MESSAGE].reduce(
    (current, known) => (known ? current.replace(known, "") : current),
    (message ?? "").normalize("NFC")
  );
  return text.trim() || null;
}

/** 실패한 run의 카드 안내. 문서별 이유는 각 줄에 있으므로 몇 개가 저장됐는지를 말한다. */
export function documentEditRunNote(run: Pick<AgentPlanRun, "status" | "error_code" | "plan"> | null | undefined): string | null {
  const failure = agentPlanFailureMessage(run);
  if (!failure) return null;
  if (failure !== PLAN_EXECUTION_FAILURE_FALLBACK && failure !== PLAN_FAILURE_FALLBACK && failure !== PLAN_PARTIAL_FAILURE_MESSAGE) return failure;
  const operations = run?.plan?.operations ?? [];
  const saved = operations.filter((operation) => SAVED_OPERATION_STATUSES.has(operation.status)).length;
  const failed = operations.filter((operation) => FAILED_OPERATION_STATUSES.has(operation.status)).length;
  const purged = operations.filter(isOperationPurged).length;
  if (purged > 0 && failed === 0) return saved > 0 ? `문서 ${saved}개를 저장했어요. 영구 삭제된 문서 ${purged}개는 실행하지 않았어요.` : DOCUMENT_PURGED_LABEL;
  if (saved > 0) return `문서 ${saved + failed}개 중 ${saved}개를 저장했어요. 저장하지 못한 문서는 문서별 이유를 확인해 주세요.`;
  if (failed > 0) return "문서를 저장하지 못했어요. 문서별 이유를 확인해 주세요.";
  return "작업을 완료하지 못했습니다. 문서별 상태를 확인해 주세요.";
}

/** 문서 행에 변경 줄이 없을 때의 안내. 수락을 기다리지 않는 run의 수정안이 만료되면 오류가 아니라 보관 기간이 지난 것이다. */
export function missingDiffNote({ isLoading, isAwaiting, isExpired }: { isLoading: boolean; isAwaiting: boolean; isExpired: boolean }): string {
  if (isLoading) return "변경 내용을 불러오는 중이에요.";
  if (!isAwaiting && isExpired) return "보관 기간이 지나 변경 내용은 볼 수 없어요. 로그에서 확인할 수 있어요.";
  return "변경 내용을 불러오지 못했어요.";
}

/** 미리 보기 상태 안내. 내용을 못 불러와도 수락은 막지 않되 확인 없이 수정된다는 점을 숨기지 않는다. */
export function editPreviewNotice({ state, missingCount, isExpired }: { state: "loading" | "error" | "ready"; missingCount: number; isExpired: boolean }): string | null {
  if (isExpired) return "변경안의 보관 기간이 지나 수락할 수 없어요. 다시 요청해 주세요.";
  if (state === "loading") return "변경 내용을 불러오는 중이에요.";
  if (state === "error") return "변경 내용을 불러오지 못했어요. 수락하면 내용을 확인하지 않은 채 고른 문서가 수정돼요.";
  if (missingCount > 0) return `문서 ${missingCount}개의 변경 내용을 불러오지 못했어요. 수락하면 내용을 확인하지 않은 채 그 문서도 수정돼요.`;
  return null;
}
