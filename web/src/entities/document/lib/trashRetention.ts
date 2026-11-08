import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";
import { ApiError } from "@/shared/lib/apiErrors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 영구 삭제까지 남은 일수(올림). 이미 지났으면 0, purge_at이 없거나 잘못됐으면 null. */
export function daysUntilPurge(purgeAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!purgeAt) return null;
  const time = Date.parse(purgeAt);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.ceil((time - now) / DAY_MS));
}

/**
 * 휴지통 항목에 보여줄 "N일 뒤 영구 삭제" 안내. 구 서버(purge_at 없음)는 보관 기간을 모른다고 알린다.
 * t(`useTranslations("shared")`)를 넘기면 지금 언어(복수형 포함)로 쓴다.
 */
export function describePurge(purgeAt: string | null | undefined, now: number = Date.now(), t?: SharedTranslate): string {
  const days = daysUntilPurge(purgeAt, now);
  if (t) {
    if (days === null) return t("trash.purgeUnknown");
    if (days === 0) return t("trash.purgeSoon");
    return days === 1 ? t("trash.purgeTomorrow") : t("trash.purgeInDays", { count: days });
  }
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

/** 복구 실패 문구. 409 만료 코드는 서버 원문 대신 보관 기간을 설명한다. t를 넘기면 정해 둔 문구를 지금 언어로 쓴다. */
export function describeRestoreError(error: unknown, fallback?: string, t?: SharedTranslate): string {
  if (error instanceof ApiError) {
    if (error.code === "TRASH_RETENTION_EXPIRED") return t ? t("trash.retentionExpired") : TRASH_RETENTION_EXPIRED_MESSAGE;
    if (error.code === "WORKSPACE_TRASH_EXPIRED") return t ? t("trash.workspaceRetentionExpired") : WORKSPACE_TRASH_EXPIRED_MESSAGE;
    if (error.status === 403) return t ? t("trash.restoreForbidden") : "문서 소유자와 워크스페이스 OWNER만 복구할 수 있습니다.";
    if (error.status === 409) {
      return t ? t("trash.restoreConflict") : "문서가 다른 곳에서 바뀌어 복구하지 못했습니다. 목록을 새로 고친 뒤 다시 시도해 주세요.";
    }
  }
  if (error instanceof Error) return error.message;
  return fallback ?? (t ? t("trash.restoreFailed") : "복구하지 못했습니다.");
}

type TreeNode = { id: string; name: string; type: string; children?: TreeNode[] | null };

/** 트리에서 문서가 있는 폴더 이름. 최상위면 null, 트리에 없으면 undefined다. 복구 응답에 위치가 없어 다시 받은 트리에서 찾는다. */
export function restoredDocumentFolderName(items: readonly TreeNode[], documentId: string, parentName: string | null = null): string | null | undefined {
  for (const item of items) {
    if (item.type !== "folder" && item.id === documentId) return parentName;
    const found = item.type === "folder" ? restoredDocumentFolderName(item.children ?? [], documentId, item.name) : undefined;
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 복구 완료 문구. 돌아간 위치를 모르면(undefined) 위치를 빼고 말한다. t를 넘기면 지금 언어로 쓴다. */
export function documentRestoredMessage(name: string, folderName: string | null | undefined, t?: SharedTranslate): string {
  if (t) {
    if (folderName === undefined) return t("trash.restored", { name });
    return folderName === null ? t("trash.restoredToRoot", { name }) : t("trash.restoredToFolder", { name, folder: folderName });
  }
  const place = folderName === undefined ? "" : folderName === null ? "최상위로 " : `「${folderName}」 폴더로 `;
  return `「${name}」 문서를 ${place}복구했습니다. 편집 문서는 미편입 상태로 돌아오므로 다시 위키에 편입해야 합니다.`;
}
