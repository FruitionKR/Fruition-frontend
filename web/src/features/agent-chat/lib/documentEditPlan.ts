import { isKnownKey, type AgentChatTranslator } from "./agentChatTranslator";
import {
  agentPlanFailureKind,
  agentPlanFailureMessage,
  isOperationNotSelected,
  isOperationPurged,
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

// 영구 삭제로 변경 내용이 지워진 문서 줄의 안내는 agentChat.editPlan.purgedDiff에 있다.

/** 문서 줄 문구(agentChat.editPlan.operationError)를 둔 AI 계약의 작업 결과 코드(ai tool_http_*, document_purged). */
const OPERATION_ERROR_CODES = ["tool_http_423", "tool_http_404", "document_purged", "rollback_document_purged"] as const;
const FAILED_OPERATION_STATUSES: ReadonlySet<string> = new Set(["failed", "conflicted", "forbidden", "verification_failed"]);
const SAVED_OPERATION_STATUSES: ReadonlySet<string> = new Set(["succeeded", "completed"]);

/**
 * AI가 계획 없는 기본 문장으로 내려 주는 결과 메시지(ai WORKFLOW_DEFAULT_MESSAGE). 카드가 이미 계획을 보여 줘 안내로 되풀이하지 않는다.
 * 영어로 요청하면(response_language=en) 영어 문장으로 온다.
 */
const WORKFLOW_DEFAULT_MESSAGES = ["작업 계획을 만들었습니다. 미리보기에서 확인해 주세요.", "I've created a task plan. Please review it in the preview."];

/** 모든 작업이 문서 편집인 계획만 문서별 변경 화면으로 보여 준다. 다른 작업이 섞이면 기존 폴더 트리 화면이다. */
export function isDocumentEditPlan(plan: Pick<AgentPlan, "operations"> | null | undefined): boolean {
  return Boolean(plan && plan.operations.length > 0 && plan.operations.every((operation) => operation.tool_name === "apply_document_edit"));
}

/** 문서 줄에 보일 실행 결과. 실행 전이면 null. */
export function documentEditOperationLabel(operation: Pick<AgentPlanOperation, "status" | "error_code">, t: AgentChatTranslator): string | null {
  if (operation.status === "planned" || operation.status === "pending") return null;
  if (isOperationNotSelected(operation)) return t("plan.excluded");
  if (isKnownKey(OPERATION_ERROR_CODES, operation.error_code)) return t(`editPlan.operationError.${operation.error_code}`);
  if (operation.status === "conflicted") return t("editPlan.conflicted");
  return planOperationStatusLabel(operation.status, t);
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

/** 트리에 없는 문서 줄이 있어 휴지통을 읽어야 이름·이유를 말할 수 있는지. 평소 카드는 휴지통을 읽지 않는다. */
export function documentEditRowsNeedTrash(rows: readonly Pick<FolderOrganizeRow, "id" | "isPurged">[], tree: readonly PlanTreeItem[] | undefined): boolean {
  if (!tree) return false;
  const paths = treePaths(tree);
  return rows.some((row) => !row.isPurged && !paths.has(row.id));
}

/** 계획의 줄(buildFolderOrganizeView)에 트리 경로·미리 보기·실행 결과를 붙인다. */
export function buildDocumentEditRows(
  plan: Pick<AgentPlan, "operations">,
  rows: readonly FolderOrganizeRow[],
  previews: AgentRunEditPreviews | null | undefined,
  tree: readonly PlanTreeItem[],
  /** 휴지통 문서. 트리에 없는 줄의 이름과 이유를 말하는 데 쓴다. 못 읽었으면 비워 둔다. */
  trash: readonly { id: string; display_name: string }[],
  t: AgentChatTranslator
): DocumentEditRow[] {
  const operations = new Map(plan.operations.map((operation) => [operation.id, operation]));
  const previewByOperation = new Map((previews?.items ?? []).map((item) => [item.operation_id, item]));
  const paths = treePaths(tree);
  const trashNames = new Map(trash.map((document) => [document.id, document.display_name.normalize("NFC")]));
  return rows.map((row) => {
    const rowOperations = row.operationIds.flatMap((id) => operations.get(id) ?? []);
    const preview = row.operationIds.map((id) => previewByOperation.get(id)).find(Boolean);
    // 결과가 갈리면 실패한 작업을 보여 준다.
    const shown = rowOperations.find((operation) => FAILED_OPERATION_STATUSES.has(operation.status)) ?? rowOperations[0];
    return {
      id: row.id,
      operationIds: row.operationIds,
      title: paths.get(row.id) ?? (preview?.display_name.normalize("NFC") || trashNames.get(row.id) || row.originalName),
      // 영구 삭제된 줄은 결과 문구가 이유를 말하고, AI가 바꾼 reason은 같은 말이다.
      summary: row.isPurged ? "" : (preview?.summary.trim() || row.reason).normalize("NFC"),
      addedLines: preview?.added_lines ?? 0,
      removedLines: preview?.removed_lines ?? 0,
      hunks: preview?.hunks ?? null,
      warning: rowOperations.find((operation) => operation.warning)?.warning?.message.trim().normalize("NFC") || null,
      resultLabel: shown?.error_code === "tool_http_404" && trashNames.has(row.id) ? t("editPlan.trashed") : shown ? documentEditOperationLabel(shown, t) : null,
      isFailure: shown ? FAILED_OPERATION_STATUSES.has(shown.status) : false,
      excluded: row.excluded || row.isPurged,
      isPurged: row.isPurged
    };
  });
}

/** 수락 전 안내. 고른 수를 따라 바뀌므로 계획 요약을 그대로 쓰지 않는다. */
export function documentEditDecisionNote(selectedCount: number, t: AgentChatTranslator): string {
  return selectedCount > 0 ? t("editPlan.decisionNote", { count: selectedCount }) : t("editPlan.decisionNoteEmpty");
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
export function documentEditApprovalHint(
  { selectedCount, excludedCount, canApply }: Pick<FolderOrganizeApproval, "selectedCount" | "excludedCount" | "canApply">,
  purgedCount: number,
  blockedCount: number,
  t: AgentChatTranslator
): string | null {
  const userExcluded = excludedCount - purgedCount - blockedCount;
  if (selectedCount === 0 && blockedCount > 0 && userExcluded === 0) return null;
  if (selectedCount === 0) return purgedCount > 0 && userExcluded === 0 ? t("editPlan.approvalHint.allPurged") : t("editPlan.approvalHint.selectOne");
  if (!canApply || userExcluded === 0) return null;
  return t("editPlan.approvalHint.excluded", { count: userExcluded });
}

/**
 * 결과 메시지에서 계획 요약·기본 문장을 뺀 나머지. 보기 권한으로 뺐거나 바뀐 내용이 없어 뺀 문서 안내가 여기 담겨 온다(계약의 "결과 메시지에 안내").
 */
export function documentEditMessageNotice(message: string | null | undefined, planSummary: string | null | undefined): string | null {
  const summary = (planSummary ?? "").trim().normalize("NFC");
  const text = [summary, ...WORKFLOW_DEFAULT_MESSAGES].reduce(
    (current, known) => (known ? current.replace(known, "") : current),
    (message ?? "").normalize("NFC")
  );
  return text.trim() || null;
}

/** 실패한 run의 카드 안내. 문서별 이유는 각 줄에 있으므로 몇 개가 저장됐는지를 말한다. */
export function documentEditRunNote(run: Pick<AgentPlanRun, "status" | "error_code" | "plan"> | null | undefined, t: AgentChatTranslator): string | null {
  const kind = agentPlanFailureKind(run);
  if (!kind) return null;
  if (kind === "code") return agentPlanFailureMessage(run, t);
  const operations = run?.plan?.operations ?? [];
  const saved = operations.filter((operation) => SAVED_OPERATION_STATUSES.has(operation.status)).length;
  const failed = operations.filter((operation) => FAILED_OPERATION_STATUSES.has(operation.status)).length;
  const purged = operations.filter(isOperationPurged).length;
  if (purged > 0 && failed === 0) return saved > 0 ? t("editPlan.runNote.savedSomePurged", { saved, purged }) : t("editPlan.operationError.document_purged");
  if (saved > 0) return t("editPlan.runNote.savedSome", { saved, total: saved + failed });
  if (failed > 0) return t("editPlan.runNote.noneSaved");
  return t("editPlan.runNote.incomplete");
}

/** 문서 행에 변경 줄이 없을 때의 안내. 수락을 기다리지 않는 run의 수정안이 만료되면 오류가 아니라 보관 기간이 지난 것이다. */
export function missingDiffNote({ isLoading, isAwaiting, isExpired }: { isLoading: boolean; isAwaiting: boolean; isExpired: boolean }, t: AgentChatTranslator): string {
  if (isLoading) return t("editPlan.diff.loading");
  if (!isAwaiting && isExpired) return t("editPlan.diff.expired");
  return t("editPlan.diff.failed");
}

/** 미리 보기 상태 안내. 내용을 못 불러와도 수락은 막지 않되 확인 없이 수정된다는 점을 숨기지 않는다. */
export function editPreviewNotice({ state, missingCount, isExpired }: { state: "loading" | "error" | "ready"; missingCount: number; isExpired: boolean }, t: AgentChatTranslator): string | null {
  if (isExpired) return t("editPlan.previewNotice.expired");
  if (state === "loading") return t("editPlan.diff.loading");
  if (state === "error") return t("editPlan.previewNotice.failed");
  if (missingCount > 0) return t("editPlan.previewNotice.missing", { count: missingCount });
  return null;
}
