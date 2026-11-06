import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDocuments, type DocumentItemResponse } from "@/entities/document";
import { readWorkspaceId } from "@/shared/api/client";
import {
  canAddComposerDocument,
  composerDocumentOptions,
  moveActiveOption,
  parseDocumentMention,
  REFERENCE_DOCUMENT_LIMIT_MESSAGE,
  removeDocumentMention
} from "../lib/composerDocuments";

/** "@" 목록에 그리는 최대 항목 수. 문서가 많으면 글자를 더 쳐서 거른다. */
const MENTION_OPTION_LIMIT = 20;
const NO_DOCUMENTS: DocumentItemResponse[] = [];

/**
 * 작업 입력창의 문서 고르기: "@" 목록(입력창에 포커스를 둔 combobox)과 "+ 문서 추가" 검색 창.
 * "@" 목록은 처음 항목이 골라진 채 열려 Enter로 바로 첨부한다. 맞는 문서가 없으면 Enter는 보내지 않고 목록만 닫는다
 * ("@회의"가 첨부 없이 그대로 나가 근거 없이 답하는 일을 막는다). Esc는 목록만 닫는다.
 */
export function useDocumentPicker({
  value,
  isEnabled,
  attachments,
  openDocument,
  onAttach,
  onChange,
  getInput
}: {
  value: string;
  isEnabled: boolean;
  /** 지금 첨부로 보이는 문서 */
  attachments: readonly DocumentItemResponse[];
  /** isReference: 편집 문맥이 아니라 첨부로 실려 첨부 자리를 차지한다(보기 권한으로 연 문서). */
  openDocument: { id: string | null; isAttached: boolean; isReference: boolean; attach: () => void };
  onAttach: (document: DocumentItemResponse) => void;
  onChange: (value: string) => void;
  getInput: () => HTMLTextAreaElement | null | undefined;
}) {
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  // 닫은 뒤 입력이 바뀌면 닫은 표시를 지운다. 지우고 같은 글자를 다시 쳐도 열린다.
  if (dismissedValue !== null && dismissedValue !== value) setDismissedValue(null);
  const mention = isEnabled ? parseDocumentMention(value, caret) : null;
  const isMentionOpen = mention !== null && dismissedValue !== value;
  const workspaceId = readWorkspaceId();
  // 스킬 참고 문서 고르기와 같은 쿼리 키를 쓴다. 열 때마다 다시 받아 그 사이 지운 문서를 뺀다.
  const documentsQuery = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: fetchDocuments,
    enabled: isEnabled && (isDialogOpen || isMentionOpen) && Boolean(workspaceId)
  });
  const documents = documentsQuery.data ?? NO_DOCUMENTS;
  const openDocumentId = openDocument.id;
  const isOpenDocumentAttached = openDocument.isAttached;
  const isOpenDocumentReference = openDocument.isReference;
  const query = mention?.query ?? "";
  const mentionOptions = useMemo(
    () => composerDocumentOptions({ documents, attachments, openDocumentId, isOpenDocumentAttached, isOpenDocumentReference, query }).slice(0, MENTION_OPTION_LIMIT),
    [attachments, documents, isOpenDocumentAttached, isOpenDocumentReference, openDocumentId, query]
  );
  const dialogDocuments = useMemo(
    () => composerDocumentOptions({ documents, attachments, openDocumentId, isOpenDocumentAttached, isOpenDocumentReference, query: "" }),
    [attachments, documents, isOpenDocumentAttached, isOpenDocumentReference, openDocumentId]
  );
  const activeOption = mentionOptions.find((item) => item.id === activeId) ?? mentionOptions[0] ?? null;
  const isOpenDocumentDetached = openDocumentId !== null && !isOpenDocumentAttached;
  const canAdd = canAddComposerDocument(attachments.length, isOpenDocumentDetached, { isOpenDocumentReference, isOpenDocumentAttached });
  const limitMessage = canAdd ? null : REFERENCE_DOCUMENT_LIMIT_MESSAGE;
  const listStatusMessage = documentsQuery.isLoading
    ? "문서 목록을 불러오는 중이에요."
    : documentsQuery.error
      ? "문서 목록을 불러오지 못했어요."
      : null;
  const mentionStatusMessage = listStatusMessage ?? limitMessage ?? (query ? "맞는 문서가 없어요." : "첨부할 수 있는 문서가 없어요.");

  function attachDocument(document: DocumentItemResponse) {
    if (document.id === openDocumentId) openDocument.attach();
    else onAttach(document);
  }

  function pickMention(document: DocumentItemResponse) {
    attachDocument(document);
    setActiveId(null);
    if (!mention) return;
    const next = removeDocumentMention(value, mention);
    onChange(next.value);
    setCaret(next.caret);
    // 값이 그려진 뒤 커서를 지운 자리로 옮긴다.
    requestAnimationFrame(() => {
      const input = getInput();
      input?.focus();
      input?.setSelectionRange(next.caret, next.caret);
    });
  }

  function closeDialog() {
    setIsDialogOpen(false);
    // 모달이 포커스를 돌려준 뒤에 연 버튼으로 맞춘다(Safari는 클릭한 버튼에 포커스를 주지 않아 돌려줄 곳이 없다).
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  /** 검색 창에서 골랐다. 이어서 요청을 쓰도록 입력창으로 옮긴다(3개를 다 고르면 연 버튼은 비활성이 된다). */
  function pickFromDialog(document: DocumentItemResponse) {
    attachDocument(document);
    setIsDialogOpen(false);
    requestAnimationFrame(() => getInput()?.focus());
  }

  /** 입력창 키 처리. 목록이 열려 있을 때만 가로챈다. 한글 조합 중 키는 조합을 끝내는 키라 아무것도 하지 않는다(Safari는 keyCode 229로만 알 수 있다). */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!isMentionOpen) return false;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return true;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveId(moveActiveOption(mentionOptions.map((item) => item.id), activeOption?.id ?? null, event.key === "ArrowDown" ? 1 : -1));
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedValue(value);
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      if (activeOption) {
        event.preventDefault();
        pickMention(activeOption);
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setDismissedValue(value);
        return true;
      }
    }
    return false;
  }

  return {
    canAdd,
    limitMessage,
    addButtonRef,
    isMentionOpen,
    mentionOptions,
    mentionStatusMessage,
    activeOptionId: activeOption?.id ?? null,
    setActiveId,
    pickMention,
    handleKeyDown,
    setCaret,
    /** 입력창을 떠나면 "@" 목록을 닫는다. 목록 항목은 포커스를 빼앗지 않아 고를 때는 닫히지 않는다. */
    dismissMention: () => { if (isMentionOpen) setDismissedValue(value); },
    isDialogOpen,
    dialogDocuments,
    dialogStatusMessage: listStatusMessage,
    openDialog: () => setIsDialogOpen(true),
    closeDialog,
    pickFromDialog
  };
}
