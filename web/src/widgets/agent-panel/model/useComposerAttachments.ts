import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchDocuments, type DocumentItemResponse } from "@/entities/document";
import { getWorkspaceId } from "@/shared/api/client";
import { mergeMovedAttachments, parseStoredAttachments, pruneUnavailableAttachments, REFERENCE_DOCUMENT_MAX, serializeAttachments } from "../lib/composerDocuments";

const NO_ATTACHMENTS: readonly DocumentItemResponse[] = [];

/**
 * 입력창에 첨부한 문서. scopeKey(워크스페이스·탭·대화)에 묶어 다른 대화로 넘어가지 않는다.
 * 보내면 비우고, 요청이 시작되지 못해 되돌릴 수 있게 보낸 문서를 기억해 둔다.
 * storageKey를 주면 입력 초안처럼 sessionStorage에 두어 새로고침해도 남긴다. 복원한 뒤 지금 쓸 수 없는 문서는 빼고 onUnavailable로 수를 알린다.
 */
export function useComposerAttachments(scopeKey: string, { storageKey = null, onUnavailable }: { storageKey?: string | null; onUnavailable?: (count: number) => void } = {}) {
  const [state, setState] = useState<{ scopeKey: string; documents: readonly DocumentItemResponse[] }>({ scopeKey, documents: NO_ATTACHMENTS });
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const sentRef = useRef<readonly DocumentItemResponse[]>(NO_ATTACHMENTS);
  const queryClient = useQueryClient();
  const attachments = state.scopeKey === scopeKey ? state.documents : NO_ATTACHMENTS;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const update = useCallback((next: (current: readonly DocumentItemResponse[]) => readonly DocumentItemResponse[]) => {
    setState((current) => ({
      scopeKey: scopeKeyRef.current,
      documents: next(current.scopeKey === scopeKeyRef.current ? current.documents : NO_ATTACHMENTS)
    }));
  }, []);

  const attach = useCallback((document: DocumentItemResponse) => {
    update((current) => (current.some((item) => item.id === document.id) ? current : [...current, document]));
  }, [update]);

  const remove = useCallback((documentId: string) => {
    update((current) => current.filter((item) => item.id !== documentId));
  }, [update]);

  // 복원이 화면에 반영된 키. 그 전에는 빈 첨부로 저장값을 덮어쓰지 않는다.
  const restoredKeyRef = useRef<string | null>(null);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  useEffect(() => {
    restoredKeyRef.current = null;
    if (!storageKey) return;
    let raw: string | null = null;
    try { raw = window.sessionStorage.getItem(storageKey); } catch { /* 저장이 막혀 있으면 복원하지 않는다. */ }
    const stored = parseStoredAttachments(raw);
    if (stored.length === 0) {
      restoredKeyRef.current = storageKey;
      return;
    }
    update((current) => mergeMovedAttachments(stored, current, REFERENCE_DOCUMENT_MAX).documents);
    let isCancelled = false;
    // 목록을 못 받으면 칩을 그대로 두어 다시 보낼 때 서버가 가린다.
    void queryClient.fetchQuery({ queryKey: ["documents", getWorkspaceId()], queryFn: fetchDocuments, staleTime: 0 })
      .then((documents) => {
        if (isCancelled) return;
        const available = new Set(pruneUnavailableAttachments(stored, documents).map((document) => document.id));
        const missing = stored.filter((document) => !available.has(document.id)).map((document) => document.id);
        if (missing.length === 0) return;
        update((current) => current.filter((document) => !missing.includes(document.id)));
        onUnavailableRef.current?.(missing.length);
      })
      .catch(() => undefined);
    return () => { isCancelled = true; };
  }, [queryClient, storageKey, update]);
  useEffect(() => {
    if (!storageKey) return;
    if (restoredKeyRef.current !== storageKey) {
      if (attachments.length === 0) return;
      restoredKeyRef.current = storageKey;
    }
    try {
      if (attachments.length > 0) window.sessionStorage.setItem(storageKey, serializeAttachments(attachments));
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* 브라우저 저장이 막혀도 현재 첨부는 유지한다. */ }
  }, [attachments, storageKey]);

  function markSent() {
    sentRef.current = attachments;
    update(() => NO_ATTACHMENTS);
  }

  /** 시작되지 못했거나 되물은 요청의 첨부를 되돌리고(그사이 새로 고른 첨부가 있으면 그대로 둔다), 최신 목록으로 지금 고를 수 없는 문서를 뺀다. 목록을 못 받으면 칩을 그대로 두어 다시 보낼 때 서버가 가린다. */
  const restore = useCallback((documentIds: readonly string[]) => {
    update((current) => (current.length > 0 ? current : sentRef.current.filter((document) => documentIds.includes(document.id))));
    void queryClient.fetchQuery({ queryKey: ["documents", getWorkspaceId()], queryFn: fetchDocuments, staleTime: 0 })
      .then((documents) => update((current) => pruneUnavailableAttachments(current, documents)))
      .catch(() => undefined);
  }, [queryClient, update]);

  /** 다른 탭에서 옮긴 첨부를 최신 목록에서 찾아 붙인다. 지금 고를 수 없거나 한도에 막힌 문서 수를 돌려준다. */
  const addMoved = useCallback(async (documentIds: readonly string[]): Promise<number> => {
    const documents = await queryClient.fetchQuery({ queryKey: ["documents", getWorkspaceId()], queryFn: fetchDocuments, staleTime: 0 });
    const available = pruneUnavailableAttachments(documents.filter((document) => documentIds.includes(document.id)), documents);
    const merged = mergeMovedAttachments(attachmentsRef.current, available, REFERENCE_DOCUMENT_MAX);
    update(() => merged.documents);
    return documentIds.length - available.length + merged.droppedCount;
  }, [queryClient, update]);

  return { attachments, attach, remove, markSent, restore, addMoved };
}
