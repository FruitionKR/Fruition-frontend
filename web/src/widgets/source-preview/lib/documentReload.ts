import type { DocumentStatus } from "@/entities/tree/model/tree";

/** revision은 변환 중 묶음이 추가될 때마다 바뀌는 값(processing_stage·updated_at). */
export type OpenDocumentState = { id: string | null; status?: DocumentStatus; converting: boolean; revision?: string };

/**
 * 열린 문서를 실제 본문으로 다시 불러올지 정한다.
 * - 처리 완료(processing→completed): 미저장 편집이 있으면 remount로 입력이 유실되므로 건너뛴다.
 * - PDF 변환 종료: 변환 직후 곧바로 인제스트(processing)로 넘어가 completed가 보이지 않을 수 있다.
 *   변환 중에는 편집기가 없어 미저장 편집이 없으므로 항상 다시 불러온다.
 * - 변환 진행: 서버가 페이지 묶음마다 본문을 이어 붙이므로 revision이 바뀌면 다시 불러온다.
 */
/**
 * AI 계획이 서버에서 저장한 문서를 열어 두고 있으면 본문을 다시 읽을지. 편집기를 다시 만들므로 저장 안 된 입력이나 검토 중인 제안이 있으면 건드리지 않는다.
 * 그때는 다음 저장에서 서버가 합친 본문을 받는다(useNoteAutosave onServerMerge).
 */
export function shouldReloadForSavedPlan({ openDocumentId, savedDocumentIds, isSaved, hasUnsyncedInput, hasActiveReview }: {
  openDocumentId: string | null;
  savedDocumentIds: readonly string[];
  isSaved: boolean;
  hasUnsyncedInput: boolean;
  hasActiveReview: boolean;
}): boolean {
  return openDocumentId !== null && savedDocumentIds.includes(openDocumentId) && isSaved && !hasUnsyncedInput && !hasActiveReview;
}

/**
 * 다시 읽은 본문을 편집기에 적용할지. 저장 계획 재조회는 요청할 때 입력이 없었어도 응답을 기다리는 동안 입력이 생길 수 있어 도착 시점에 다시 본다.
 * 입력이 있으면 버리고 다음 저장의 서버 병합에 맡긴다. 그사이 쳐서 저장한 입력(hasEditedSinceRequest)은 이 응답에 없을 수 있어 함께 본다.
 * 다른 문서를 열 때와 변환 종료·처리 완료 경로(isForced)는 지금처럼 항상 적용한다.
 */
export function shouldApplyReloadedNote({ isSameDocumentReload, isForced, isSaved, hasUnsyncedInput, hasActiveReview, hasEditedSinceRequest }: {
  isSameDocumentReload: boolean;
  isForced: boolean;
  isSaved: boolean;
  hasUnsyncedInput: boolean;
  hasActiveReview: boolean;
  hasEditedSinceRequest: boolean;
}): boolean {
  if (!isSameDocumentReload || isForced) return true;
  return isSaved && !hasUnsyncedInput && !hasActiveReview && !hasEditedSinceRequest;
}

export function shouldReloadOpenDocument(previous: OpenDocumentState, current: OpenDocumentState, saved: boolean): boolean {
  if (previous.id !== current.id) return false;
  if (previous.converting && !current.converting) return true;
  if (previous.converting && current.converting && previous.revision !== current.revision) return true;
  return previous.status === "processing" && current.status === "completed" && saved;
}
