import { currentSharedTranslate, type SharedTranslate } from "@/shared/i18n/sharedTranslate";
import { ApiError, UPLOAD_LIMIT_MESSAGES, usageLimitMessage } from "@/shared/lib/apiErrors";

/** 무료 워크스페이스 한도 거절 안내. 영어 문구는 shared.workspace.limitExceeded */
const WORKSPACE_LIMIT_EXCEEDED_MESSAGE = "무료 워크스페이스를 더 만들 수 없습니다. 사용하지 않는 워크스페이스를 삭제한 뒤 다시 시도해 주세요.";

/**
 * 용량·개수 제한 에러면 정해 둔 안내 문구를, 아니면 null을 돌려준다. 서버 message 대신 이 문구로 안내한다.
 * t를 넘기지 않으면 브라우저에 등록된 지금 언어 번역 함수를 쓰고, 그것도 없으면(서버 렌더·테스트) 한국어 문구다.
 */
export function describeLimitError(error: unknown, t: SharedTranslate | undefined = currentSharedTranslate()): string | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  if (error.code === "WORKSPACE_LIMIT_EXCEEDED") return t ? t("workspace.limitExceeded") : WORKSPACE_LIMIT_EXCEEDED_MESSAGE;
  return error.code in UPLOAD_LIMIT_MESSAGES ? usageLimitMessage(error.code, null, t) : null;
}

/** 무료 워크스페이스를 더 만들 수 없는지. 한도(null)가 없거나 서버가 값을 주지 않으면 막지 않는다. */
export function isFreeWorkspaceLimitReached(count: number | undefined, limit: number | null | undefined): boolean {
  return typeof count === "number" && typeof limit === "number" && count >= limit;
}
