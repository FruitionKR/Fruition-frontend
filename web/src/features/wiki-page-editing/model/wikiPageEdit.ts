import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import type { WorkspaceRole } from "@/entities/workspace/api/members";
import type { WikiPageContentSaveRequest, WikiPageDetailResponse } from "@/entities/wiki";

/** 본문 저장에 필요한 권한 항목(access #32). OWNER는 항상 가진다. */
export const WIKI_EDIT_PERMISSION = "wiki.ingest";

export const WIKI_EDIT_PERMISSION_HINT =
  "위키 페이지를 고치려면 OWNER이거나 위키 편입(wiki.ingest) 권한이 있어야 합니다. OWNER에게 권한을 요청해 주세요.";

export const WIKI_PAGE_CONFLICT_MESSAGE =
  "다른 작업이 먼저 반영됐습니다. 최신 본문을 확인한 뒤 내 편집을 그 위에 다시 저장하거나, 내 편집을 버리고 최신 본문으로 돌아갈 수 있습니다.";

/** 역할·권한 목록으로 편집 버튼을 보일지 정한다. 역할을 모르면(null) 막는다. 최종 판단은 서버 403이다. */
export function canEditWikiPage(role: WorkspaceRole | null, permissions: readonly string[]): boolean {
  if (role === "OWNER") return true;
  return role === "MEMBER" && permissions.includes(WIKI_EDIT_PERMISSION);
}

/**
 * 편집 한 번의 상태. baseRevision은 편집을 연 시점의 revision, writeId는 같은 저장의 재시도에 그대로 쓴다.
 * sentDraft는 writeId로 마지막에 보낸 본문이다. 본문이 그 뒤 바뀌면 같은 writeId를 쓰면 409 IDEMPOTENCY_CONFLICT라 새로 만든다.
 */
export type WikiPageEditSession = {
  draft: string;
  baseRevision: number;
  writeId: string;
  sentDraft: string | null;
};

/** 버전 이력이 없는 페이지는 revision 키가 없고 base_revision 0으로 저장한다(document #130). */
export function createWikiPageEditSession(
  page: Pick<WikiPageDetailResponse, "markdown" | "revision">,
  writeId: string = crypto.randomUUID()
): WikiPageEditSession {
  return { draft: page.markdown ?? "", baseRevision: page.revision ?? 0, writeId, sentDraft: null };
}

/**
 * 보낼 세션을 정한다. 이 writeId로 보낸 적 없거나 같은 본문이면(503 뒤 재시도) writeId를 그대로 두고,
 * 보낸 뒤 본문을 더 고쳤으면 다른 저장이므로 writeId를 새로 만든다.
 */
export function prepareWikiPageSave(session: WikiPageEditSession, writeId: string = crypto.randomUUID()): WikiPageEditSession {
  const isRetry = session.sentDraft === null || session.sentDraft === session.draft;
  return { ...session, writeId: isRetry ? session.writeId : writeId, sentDraft: session.draft };
}

export function buildWikiPageSaveRequest(session: WikiPageEditSession): WikiPageContentSaveRequest {
  return { markdown: session.draft, base_revision: session.baseRevision, revision_write_id: session.writeId };
}

/** 409 뒤 내 편집은 그대로 두고 최신 revision 위에 다시 저장한다. 다른 작업이라 write ID도 새로 만든다. */
export function rebaseWikiPageEditSession(
  session: WikiPageEditSession,
  latestRevision: number,
  writeId: string = crypto.randomUUID()
): WikiPageEditSession {
  return { ...session, baseRevision: latestRevision, writeId, sentDraft: null };
}

/** 같은 writeId를 다른 본문에 쓴 409 IDEMPOTENCY_CONFLICT. 호출부는 버전 충돌처럼 최신 본문을 받아 새 writeId로 다시 저장하게 한다. */
export function isWikiPageIdempotencyConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT";
}

/**
 * 저장 실패를 다음 행동이 보이는 문구로 바꾼다. 버전 충돌·IDEMPOTENCY_CONFLICT는 호출부가 따로 다룬다.
 * 403 WORKSPACE_PERMISSION_REQUIRED·402 INSUFFICIENT_CREDIT은 앱 공통 문구(getErrorMessage)를 그대로 쓴다.
 * 503은 같은 본문이면 같은 writeId로 다시 보내면 된다(prepareWikiPageSave).
 */
export function describeWikiPageSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "WIKI_PAGE_PIPELINE_UNAVAILABLE" || error.status === 503) {
      return "AI 서비스가 응답하지 않아 저장하지 못했습니다. 잠시 뒤 다시 저장해 주세요.";
    }
    if (error.status === 413) return "본문이 5MB를 넘어 저장할 수 없습니다.";
    if (error.status === 404) return "페이지를 찾을 수 없습니다. 삭제됐거나 다른 워크스페이스의 페이지입니다.";
  }
  return getErrorMessage(error, "Wiki page를 저장하지 못했습니다.");
}
