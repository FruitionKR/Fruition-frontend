"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWikiPage, saveWikiPageContent, WikiPageVersionConflictError } from "@/entities/wiki";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import type { WikiPageDetailResponse } from "@/entities/wiki";
import {
  buildWikiPageSaveRequest,
  createWikiPageEditSession,
  describeWikiPageSaveError,
  isWikiPageIdempotencyConflict,
  prepareWikiPageSave,
  rebaseWikiPageEditSession,
  WIKI_PAGE_CONFLICT_MESSAGE,
  type WikiPageEditSession
} from "./wikiPageEdit";

/** 버전 충돌 뒤 비교용으로 받은 최신 본문. loading 동안은 latest가 null이다. */
export type WikiPageEditConflict = {
  currentRevision: number | null;
  latest: WikiPageDetailResponse | null;
  isLoading: boolean;
  loadError: string | null;
};

export type WikiPageEditState =
  | { mode: "view" }
  | {
      mode: "edit";
      session: WikiPageEditSession;
      isSaving: boolean;
      error: string | null;
      conflict: WikiPageEditConflict | null;
    };

/**
 * 위키 페이지 본문 편집 상태. 편집을 열 때 revision·write ID를 잡고, 저장 409(버전 충돌)면 내 편집을 보존한 채
 * 최신 본문을 받아 비교하게 한다. 실패 뒤 같은 본문을 다시 저장하면 같은 write ID를 쓴다(503 재시도).
 */
export function useWikiPageEdit({
  page,
  onSaved,
  onReplaced
}: {
  page: WikiPageDetailResponse | null;
  /** 저장 성공. 호출부가 페이지 상태(markdown·revision)를 갱신하고 그래프를 다시 받는다. */
  onSaved: (next: { markdown: string; revision: number; updated_at: string }) => void;
  /** 충돌 뒤 내 편집을 버리고 최신 본문으로 돌아갈 때. 호출부가 페이지 상태를 통째로 바꾼다. */
  onReplaced: (latest: WikiPageDetailResponse) => void;
}) {
  const [state, setState] = useState<WikiPageEditState>({ mode: "view" });
  const pageId = page?.id ?? null;
  // 페이지를 바꾸면 편집 중이던 내용은 버린다(다른 페이지의 revision으로 저장하면 안 된다).
  useEffect(() => {
    setState({ mode: "view" });
  }, [pageId]);
  // 저장 응답이 돌아왔을 때 편집이 이미 닫혔거나 다른 페이지로 바뀌었으면 반영하지 않는다.
  const activePageIdRef = useRef<string | null>(null);
  activePageIdRef.current = pageId;

  const start = useCallback(() => {
    if (!page) return;
    setState({ mode: "edit", session: createWikiPageEditSession(page), isSaving: false, error: null, conflict: null });
  }, [page]);

  const updateDraft = useCallback((draft: string) => {
    setState((current) => (current.mode === "edit" ? { ...current, session: { ...current.session, draft } } : current));
  }, []);

  const cancel = useCallback(() => {
    setState({ mode: "view" });
  }, []);

  const loadLatest = useCallback(async (targetPageId: string, currentRevision: number | null) => {
    try {
      const latest = await fetchWikiPage(targetPageId);
      if (activePageIdRef.current !== targetPageId) return;
      setState((current) => current.mode === "edit" && current.conflict
        ? { ...current, conflict: { ...current.conflict, latest, isLoading: false } }
        : current);
    } catch (error) {
      if (activePageIdRef.current !== targetPageId) return;
      setState((current) => current.mode === "edit" && current.conflict
        ? { ...current, conflict: { currentRevision, latest: null, isLoading: false, loadError: getErrorMessage(error, "최신 본문을 불러오지 못했습니다.") } }
        : current);
    }
  }, []);

  const saveSession = useCallback(async (targetPageId: string, pending: WikiPageEditSession) => {
    const session = prepareWikiPageSave(pending);
    setState((current) => (current.mode === "edit" ? { ...current, session, isSaving: true, error: null, conflict: null } : current));
    try {
      const saved = await saveWikiPageContent(targetPageId, buildWikiPageSaveRequest(session));
      if (activePageIdRef.current !== targetPageId) return;
      onSaved({ markdown: saved.markdown, revision: saved.revision, updated_at: saved.updated_at });
      setState({ mode: "view" });
    } catch (error) {
      if (activePageIdRef.current !== targetPageId) return;
      // 버전 충돌과 write ID 재사용 충돌은 모두 최신 본문을 받아 그 위에 새 write ID로 다시 저장하게 한다.
      if (error instanceof WikiPageVersionConflictError || isWikiPageIdempotencyConflict(error)) {
        const currentRevision = error instanceof WikiPageVersionConflictError ? error.currentRevision : null;
        setState((current) => current.mode === "edit"
          ? { ...current, isSaving: false, error: WIKI_PAGE_CONFLICT_MESSAGE, conflict: { currentRevision, latest: null, isLoading: true, loadError: null } }
          : current);
        void loadLatest(targetPageId, currentRevision);
        return;
      }
      setState((current) => current.mode === "edit"
        ? { ...current, isSaving: false, error: describeWikiPageSaveError(error) }
        : current);
    }
  }, [loadLatest, onSaved]);

  const save = useCallback(() => {
    if (!pageId || state.mode !== "edit" || state.isSaving) return;
    void saveSession(pageId, state.session);
  }, [pageId, saveSession, state]);

  /** 충돌 뒤: 내 편집을 최신 revision 위에 다시 저장한다. */
  const saveOverLatest = useCallback(() => {
    if (!pageId || state.mode !== "edit" || state.isSaving || !state.conflict?.latest) return;
    void saveSession(pageId, rebaseWikiPageEditSession(state.session, state.conflict.latest.revision ?? 0));
  }, [pageId, saveSession, state]);

  /** 충돌 뒤 최신 본문을 받지 못했을 때 다시 받는다. */
  const reloadLatest = useCallback(() => {
    if (!pageId || state.mode !== "edit" || !state.conflict || state.conflict.isLoading) return;
    const { currentRevision } = state.conflict;
    setState((current) => current.mode === "edit" && current.conflict
      ? { ...current, conflict: { ...current.conflict, isLoading: true, loadError: null } }
      : current);
    void loadLatest(pageId, currentRevision);
  }, [loadLatest, pageId, state]);

  /** 충돌 뒤: 내 편집을 버리고 최신 본문을 보여 준다. */
  const adoptLatest = useCallback(() => {
    if (state.mode !== "edit" || !state.conflict?.latest) return;
    onReplaced(state.conflict.latest);
    setState({ mode: "view" });
  }, [onReplaced, state]);

  const isDirty = state.mode === "edit" && state.session.draft !== (page?.markdown ?? "");

  return { state, isDirty, start, updateDraft, save, cancel, saveOverLatest, reloadLatest, adoptLatest };
}
