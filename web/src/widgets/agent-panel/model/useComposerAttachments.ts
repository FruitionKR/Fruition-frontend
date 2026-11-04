import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchDocuments, type DocumentItemResponse } from "@/entities/document";
import { getWorkspaceId } from "@/shared/api/client";
import { pruneUnavailableAttachments } from "../lib/composerDocuments";

const NO_ATTACHMENTS: readonly DocumentItemResponse[] = [];

/**
 * 작업 입력창에 첨부한 문서. scopeKey(워크스페이스·작업 대화)에 묶어 다른 대화로 넘어가지 않는다.
 * 보내면 비우고, 요청이 시작되지 못해 되돌릴 수 있게 보낸 문서를 기억해 둔다.
 */
export function useComposerAttachments(scopeKey: string) {
  const [state, setState] = useState<{ scopeKey: string; documents: readonly DocumentItemResponse[] }>({ scopeKey, documents: NO_ATTACHMENTS });
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const sentRef = useRef<readonly DocumentItemResponse[]>(NO_ATTACHMENTS);
  const queryClient = useQueryClient();
  const attachments = state.scopeKey === scopeKey ? state.documents : NO_ATTACHMENTS;

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

  function markSent() {
    sentRef.current = attachments;
    update(() => NO_ATTACHMENTS);
  }

  /** 시작되지 못한 요청의 첨부를 되돌리고, 최신 목록으로 지금 고를 수 없는 문서를 뺀다. 목록을 못 받으면 칩을 그대로 두어 다시 보낼 때 서버가 가린다. */
  const restore = useCallback((documentIds: readonly string[]) => {
    update(() => sentRef.current.filter((document) => documentIds.includes(document.id)));
    void queryClient.fetchQuery({ queryKey: ["documents", getWorkspaceId()], queryFn: fetchDocuments, staleTime: 0 })
      .then((documents) => update((current) => pruneUnavailableAttachments(current, documents)))
      .catch(() => undefined);
  }, [queryClient, update]);

  return { attachments, attach, remove, markSent, restore };
}
