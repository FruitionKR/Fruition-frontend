import type { DocumentStatus } from "@/entities/tree/model/tree";

export type OpenDocumentState = { id: string | null; status?: DocumentStatus; converting: boolean };

/**
 * 열린 문서를 실제 본문으로 다시 불러올지 정한다.
 * - 처리 완료(processing→completed): 미저장 편집이 있으면 remount로 입력이 유실되므로 건너뛴다.
 * - PDF 변환 종료: 변환 직후 곧바로 인제스트(processing)로 넘어가 completed가 보이지 않을 수 있다.
 *   변환 중에는 편집기가 없어 미저장 편집이 없으므로 항상 다시 불러온다.
 */
export function shouldReloadOpenDocument(previous: OpenDocumentState, current: OpenDocumentState, saved: boolean): boolean {
  if (previous.id !== current.id) return false;
  if (previous.converting && !current.converting) return true;
  return previous.status === "processing" && current.status === "completed" && saved;
}
