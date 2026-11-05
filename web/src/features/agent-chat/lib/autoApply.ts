import type { AgentTurnAction, GeneratedMarkdownDraft } from "./agentTurn";

/**
 * 작업 탭 편집안(markdown_edit)·새 문서 초안(markdown_create)의 자동 처리 판단.
 * 이 둘은 서버 계획(AgentAutoApprovalPolicy)을 거치지 않고 프론트에서 수락하므로, 같은 설정(content_edit)을 여기서 따른다.
 * 하나라도 확실하지 않으면 지금의 수락 화면으로 둔다(fail-closed).
 */
export type TurnAutoApplyKind = "edit" | "create";

/** 조회 중·실패면 지난 값이 남아 있어도 켜진 것으로 보지 않는다. */
export function isContentEditAutoApproved(query: {
  data?: { content_edit: boolean } | null;
  isError: boolean;
  isFetching: boolean;
}): boolean {
  return !query.isError && !query.isFetching && query.data?.content_edit === true;
}

export function resolveTurnAutoApply(input: {
  action: AgentTurnAction | undefined;
  isContentEditAutoApproved: boolean;
  /** 이 응답을 이미 처리했거나 수락 화면으로 넘겼다. 같은 응답을 두 번 적용하지 않는다. */
  isAlreadyHandled: boolean;
  /** 사용자가 멈추려 한 turn(Esc 중지가 409로 끝남). 결과를 확인 없이 반영하지 않는다. */
  isManualOnly: boolean;
  /** 요청을 보낸 대화를 아직 보고 있다. 다른 대화로 옮겼으면 그 제안은 화면에서 버린 것이다. */
  isFromActiveSession: boolean;
  hasEditPreview: boolean;
  /** 적용 표(apply_operation_id). 없으면 서버가 AI 작업 로그를 남기지 않아 로그 화면에서 롤백할 수 없다. */
  hasApplyOperationId: boolean;
  validationError: string | null;
  /** 열린 편집기가 이 문서를 지금 저장할 수 있다. */
  isDocumentWritable: boolean;
  proposalCount: number;
  /** AI가 요청한 범위보다 넓게 고쳤다. 사람이 고른 범위를 넘으므로 확인받는다. */
  isScopeExpanded: boolean;
  /** 초안을 만들 폴더에 쓸 수 없다고 알고 있다. 권한을 모르면 false로 두어 서버가 판단한다. */
  isDraftFolderWriteDenied: boolean;
  draft: GeneratedMarkdownDraft | null;
}): TurnAutoApplyKind | null {
  if (!input.isContentEditAutoApproved || input.isAlreadyHandled || input.isManualOnly || !input.isFromActiveSession) return null;
  if (input.action === "markdown_create") return input.draft?.markdown.trim() && !input.isDraftFolderWriteDenied ? "create" : null;
  if (input.action !== "markdown_edit") return null;
  const canApply = input.hasEditPreview && input.hasApplyOperationId && !input.validationError && input.isDocumentWritable
    && input.proposalCount > 0 && !input.isScopeExpanded;
  return canApply ? "edit" : null;
}

const AUTO_APPLIED_PREFIX = "설정의 'AI 에이전트 자동 승인'에 따라 확인 없이 적용했어요.";
const EDIT_ROLLBACK_HINT = "이전 내용으로 돌아가려면 로그 화면에서 이 작업을 롤백하세요. 그 뒤에 고친 내용도 함께 되돌아갑니다.";

/** 자동 처리한 작업 줄에 보일 안내. 되돌리는 방법을 함께 적는다. */
export function autoAppliedTaskNote(action: string | null | undefined): string {
  return action === "markdown_create"
    ? `${AUTO_APPLIED_PREFIX} 새로 만든 문서가 필요 없으면 휴지통으로 옮기세요.`
    : `${AUTO_APPLIED_PREFIX} ${EDIT_ROLLBACK_HINT}`;
}

/**
 * 저장된 편집·초안 작업 줄의 안내. 자동 처리 기록은 이 브라우저에만 있고 서버 버전 기록은 자동·직접 적용을 가리지 않으므로,
 * 다른 브라우저에서는 자동 승인이라 단정하지 않고 되돌리는 방법만 알린다. 턴 결과 메시지의 "아직 적용하지 않았어요"는 쓰지 않는다.
 */
export function appliedTaskNote({ action, isAutoApplied, isAppliedHere, isServerApplied }: {
  action: string | null | undefined;
  isAutoApplied: boolean;
  /** 이 브라우저에 적용 기록이 있다. */
  isAppliedHere: boolean;
  /** 서버 버전 기록으로 저장을 확인했다. */
  isServerApplied: boolean;
}): string | null {
  if (isAutoApplied) return autoAppliedTaskNote(action);
  return isServerApplied && !isAppliedHere ? EDIT_ROLLBACK_HINT : null;
}
