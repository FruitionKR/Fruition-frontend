import { ApiError } from "@/shared/lib/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 영구 삭제까지 남은 일수(올림). 이미 지났으면 0, purge_at이 없거나 잘못됐으면 null. */
export function daysUntilPurge(purgeAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!purgeAt) return null;
  const time = Date.parse(purgeAt);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.ceil((time - now) / DAY_MS));
}

/** 휴지통 항목에 보여줄 "N일 뒤 영구 삭제" 안내. 구 서버(purge_at 없음)는 보관 기간을 모른다고 알린다. */
export function describePurge(purgeAt: string | null | undefined, now: number = Date.now()): string {
  const days = daysUntilPurge(purgeAt, now);
  if (days === null) return "영구 삭제 예정일을 알 수 없습니다.";
  if (days === 0) return "보관 기간이 지나 곧 영구 삭제됩니다.";
  if (days === 1) return "내일 영구 삭제됩니다.";
  return `${days}일 뒤 영구 삭제됩니다.`;
}

/** 보관 기간이 지나 복구할 수 없는 항목인지(복구 버튼 비활성). purge_at을 모르면 서버 판정에 맡긴다. */
export function isRetentionExpired(purgeAt: string | null | undefined, now: number = Date.now()): boolean {
  return daysUntilPurge(purgeAt, now) === 0;
}

export const TRASH_RETENTION_EXPIRED_MESSAGE = "보관 기간(30일)이 지나 복구할 수 없습니다. 이 문서는 곧 영구 삭제됩니다.";
export const WORKSPACE_TRASH_EXPIRED_MESSAGE = "워크스페이스 보관 기간(30일)이 지나 복구할 수 없습니다. 이 워크스페이스는 곧 영구 삭제됩니다.";

/** 복구 실패 문구. 409 만료 코드는 서버 원문 대신 보관 기간을 설명한다. */
export function describeRestoreError(error: unknown, fallback = "복구하지 못했습니다."): string {
  if (error instanceof ApiError) {
    if (error.code === "TRASH_RETENTION_EXPIRED") return TRASH_RETENTION_EXPIRED_MESSAGE;
    if (error.code === "WORKSPACE_TRASH_EXPIRED") return WORKSPACE_TRASH_EXPIRED_MESSAGE;
    if (error.status === 403) return "문서 소유자와 워크스페이스 OWNER만 복구할 수 있습니다.";
    if (error.status === 409) return "문서가 다른 곳에서 바뀌어 복구하지 못했습니다. 목록을 새로 고친 뒤 다시 시도해 주세요.";
  }
  return error instanceof Error ? error.message : fallback;
}
