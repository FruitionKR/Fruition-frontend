import type koWiki from "@/shared/i18n/messages/ko/wiki.json";
import type { MessageTranslate } from "@/shared/i18n/messageTranslate";

/**
 * 위키 편입(wiki.ingest)·위키 최신화(wiki.lint) 버튼의 권한 게이트. OWNER는 항상 가진다(hasWorkspacePermission).
 * 서버는 권한 없는 요청을 403 WORKSPACE_PERMISSION_REQUIRED로 거절하므로, 확실히 가진 경우(true)에만 요청을 보낸다.
 */

/** 권한이 없어 막힌 버튼의 말풍선·툴팁 사유. */
export const WIKI_INGEST_PERMISSION_HINT = "위키 편입 권한이 없어요";
export const WIKI_LINT_PERMISSION_HINT = "위키 최신화 권한이 없어요";

type WikiActionKind = "ingest" | "lint";

const PERMISSION_HINTS: Record<WikiActionKind, string> = {
  ingest: WIKI_INGEST_PERMISSION_HINT,
  lint: WIKI_LINT_PERMISSION_HINT
};

const PERMISSION_HINT_KEYS = { ingest: "ingestPermissionHint", lint: "lintPermissionHint" } as const;

/**
 * permission은 hasWorkspacePermission 결과다(true 있음 · false 없음 · null 역할 확인 중).
 * 확인 중이면 버튼을 막되 사유는 보이지 않는다. 곧 풀릴 수 있어 "권한이 없어요"를 잠깐 띄웠다 지우지 않는다.
 * t(`useTranslations("wiki")`)를 넘기면 사유를 지금 언어로 쓴다.
 */
export function getWikiActionGate(
  permission: boolean | null,
  kind: WikiActionKind,
  t?: MessageTranslate<typeof koWiki>
): { isBlocked: boolean; hint: string | null } {
  if (permission === true) return { isBlocked: false, hint: null };
  if (permission !== false) return { isBlocked: true, hint: null };
  return { isBlocked: true, hint: t ? t(PERMISSION_HINT_KEYS[kind]) : PERMISSION_HINTS[kind] };
}
