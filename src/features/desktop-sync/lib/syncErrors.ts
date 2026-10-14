import { ApiError, SessionExpiredError } from "@/shared/lib/errors";

/**
 * 동기화 요청 실패를 대기열이 할 일로 나눈 결과.
 * - version-conflict: 충돌로 등록하고 OWNER의 선택을 기다린다
 * - processing: 변환이 끝날 때까지 기다렸다가 다시 보낸다
 * - session-expired: 다시 로그인할 때까지 대기열에 남긴다
 * - retry: 잠시 뒤 같은 키로 다시 보낸다
 * - 나머지: 다시 보내도 결과가 같으므로 사용자에게 알린다
 */
export type SyncErrorKind =
  | "version-conflict"
  | "processing"
  | "forbidden"
  | "not-found"
  | "too-large"
  | "rejected"
  | "session-expired"
  | "retry";

/** 409는 버전 충돌과 변환 중이 같은 상태 코드라 서버 code로 구분한다. */
export function classifySyncError(error: unknown): SyncErrorKind {
  if (error instanceof SessionExpiredError) return "session-expired";
  if (!(error instanceof ApiError)) return "retry";
  if (error.status === 409 && error.code === "DOCUMENT_VERSION_CONFLICT") return "version-conflict";
  if (error.status === 409 && error.code === "DOCUMENT_ALREADY_PROCESSING") return "processing";
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not-found";
  if (error.status === 413) return "too-large";
  if (error.status >= 500 || error.status === 408 || error.status === 429) return "retry";
  return "rejected";
}
