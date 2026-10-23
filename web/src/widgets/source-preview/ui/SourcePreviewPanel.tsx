import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { DocumentMarkdownViewer as MarkdownViewer } from "@/shared/ui/markdown/DocumentMarkdownViewer";
import { useUserPreferences } from "@/entities/user";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";
import { DynamicNoteEditor } from "@/features/note-editing/ui/DynamicNoteEditor";
import { fetchDocumentBlocks, fetchDocumentOriginal, fetchDocumentReadUrl } from "@/entities/document";
import { publishNotice } from "@/features/document-notifications";
import { fetchWikiPage } from "@/entities/wiki";
import { useWorkspaceRole } from "@/entities/workspace";
import { canEditWikiPage, WikiPageContent } from "@/features/wiki-page-editing";
import { fetchNoteDraft, waitForPendingDocumentSave, type DetachedNoteSaveResult } from "@/features/note-editing";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { withPathSuffix } from "@/entities/graph/lib/documentLabels";
import { buildMarkdownDocumentFilename, getMarkdownDocumentTitle, splitEditableNoteMarkdown, stripPageComments } from "@/entities/document/lib/noteMarkdown";
import { hasMarkdownExtension, hasPdfExtension, hasTextExtension } from "@/entities/document/lib/documentKind";
import { CHAT_EXPORT_READ_ONLY_HINT, CHAT_EXPORT_READ_ONLY_TITLE, READ_ONLY_DOCUMENT_HINT, READ_ONLY_DOCUMENT_TITLE } from "@/entities/document/lib/documentAccess";
import { shouldReloadOpenDocument, type OpenDocumentState } from "../lib/documentReload";
import { getConversionNotice, type DocumentConversionView } from "@/entities/document/lib/documentConversion";
import { getCenteredScrollTop } from "../lib/centerScrollTop";
import { canShowHighlightedMarkdown, findHighlightedScrollTarget, getHighlightScrollKey } from "../lib/highlightScroll";
import {
  createMarkdownLoadSequence,
  getSourceBlocksQueryOptions,
  getSourceHighlightStatus,
  resolveHighlightRanges,
  selectSourceBlocksForLoad,
  type MarkdownLoad
} from "../lib/sourceHighlightState";
import { cx } from "@/shared/lib/classNames";
import styles from "./SourcePreviewPanel.module.css";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import { EditProposalBadge, InlineEditReview, type InlineEditReviewState } from "@/features/agent-chat/ui/InlineEditReview";
import type { SourceBlockHighlight } from "@/entities/document";
import type { DocumentStatus, NoteSaveStatus } from "@/entities/tree";
import type { WikiPageDetailResponse } from "@/entities/wiki";

// 정상 흐름(변경됨→저장됨)은 표시하지 않고, 저장 중이거나 사용자가 알아야 할 실패만 콘텐츠 우상단에 띄운다.
const SAVE_STATUS_LABELS: Partial<Record<NoteSaveStatus, string>> = {
  saving: "저장 중",
  error: "저장 실패",
  "lock-lost": "편집 권한 상실",
  "session-expired": "세션 만료"
};

export function SourcePreviewPanel({
  title,
  pageId,
  pageType,
  documentId,
  sourceBlockHighlights,
  onMarkdownEditContextChange,
  editReview = null,
  onRenameDocument,
  onRefreshDocuments,
  documentStatus,
  documentConversion = null,
  readOnly = false,
  bodyLocked = false,
  titleHint,
  titleSuffix,
  fillMain = false
}: {
  title: string;
  pageId: string | null;
  pageType: string | null;
  documentId?: string | null;
  sourceBlockHighlights?: SourceBlockHighlight[];
  onMarkdownEditContextChange?: (context: ActiveMarkdownEditContext | null) => void;
  /** 채팅 패널이 받은 편집안. 이 문서의 것이면 본문 대신 제안을 붙인 검토 화면을 보여 준다(Figma 1571:27625). */
  editReview?: InlineEditReviewState | null;
  onRenameDocument?: (documentId: string, filename: string) => Promise<void>;
  /** 저장 직후 백엔드 문서 목록을 다시 받아 알림·트리를 갱신한다. */
  onRefreshDocuments?: () => void;
  /** 열린 문서의 처리 상태. processing→completed 전이 시 본문을 다시 불러온다. */
  documentStatus?: DocumentStatus;
  /** PDF 변환이 진행 중이면 그 상태. 변환 중에는 편집기 대신 읽기 전용으로 보여준다. */
  documentConversion?: DocumentConversionView | null;
  /** 서버 can_edit=false. 편집기 대신 읽기 전용 본문을 보여주고 이름 변경을 막는다. */
  readOnly?: boolean;
  /** 권한과 무관하게 본문을 고칠 수 없는 문서(채팅 Wiki page화 문서). 편집기·편집 잠금 없이 읽기 전용 본문만 보여준다. 이름 변경은 readOnly를 따른다. */
  bodyLocked?: boolean;
  /** 제목 hover 설명(상위 폴더 경로 등). 없으면 제목을 쓴다 */
  titleHint?: string;
  /** 같은 이름의 문서를 구분하는 폴더 경로(#150). 그래프 노드 라벨과 같은 `이름 · 폴더/경로` 형식으로 보여준다. */
  titleSuffix?: string;
  /** 홈에서 문서가 메인 영역을 채울 때: 고정폭/리사이즈 대신 남은 영역을 채운다 */
  fillMain?: boolean;
}) {
  const documentConverting = documentConversion !== null;
  const conversionRevision = documentConversion?.revision;
  const [page, setPage] = useState<WikiPageDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawMarkdown, setRawMarkdown] = useState<string | null>(null);
  // 화면 본문을 불러온 문서와 로드 ID. 근거 block 조회 키로 써서 본문이 바뀌면(복원·재편입 등) block도 다시 받는다.
  // 로드 ID는 문서를 바꿔도 다시 세지 않아, 이전 로드의 키(캐시)를 재사용하지 않는다.
  const [markdownLoad, setMarkdownLoad] = useState<MarkdownLoad | null>(null);
  const [renderedMarkdownLoad, setRenderedMarkdownLoad] = useState<MarkdownLoad | null>(null);
  const handleMarkdownReady = useCallback(() => setRenderedMarkdownLoad(markdownLoad), [markdownLoad]);
  // 순번 함수는 처음 한 번만 만든다(렌더마다 만들고 버리지 않게).
  const [nextMarkdownLoad] = useState(createMarkdownLoadSequence);
  const [noteContentVersion, setNoteContentVersion] = useState(0);
  const [rawDocumentUrl, setRawDocumentUrl] = useState<string | null>(null);
  // 텍스트 원본(TXT 등)은 iframe이 흰 배경으로 그리므로 본문을 직접 받아 패널 배경 위에 그린다.
  const [rawText, setRawText] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState(() => getMarkdownDocumentTitle(title));
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const skipNextTitleCommitRef = useRef(false);
  // 변환·분석이 끝난 문서의 본문·버전을 다시 불러오기 위한 카운터
  const [documentReloadCount, setDocumentReloadCount] = useState(0);
  // 현재 화면에 본문이 올라와 있는 문서. 같은 문서 재조회인지 판별해 깜빡임을 막는다.
  const loadedDocumentIdRef = useRef<string | null>(null);
  // 편집기의 즉시 저장 함수 (Cmd/Ctrl+S에서 호출)
  const noteSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerNoteSave = useCallback((save: () => Promise<boolean>) => {
    noteSaveRef.current = save;
  }, []);
  const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("saved");
  const noteSaveStatusRef = useRef<NoteSaveStatus>("saved");
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const [editorReadOnlyNotice, setEditorReadOnlyNotice] = useState<{ documentId: string; message: string | null } | null>(null);
  const handleReadOnlyNoticeChange = useCallback((id: string, message: string | null) => {
    setEditorReadOnlyNotice(current => !message && current?.documentId !== id ? current : { documentId: id, message });
  }, []);
  // 변환·분석 중(placeholder 본문)에 열어 둔 문서가 완료되거나 변환 묶음이 추가되면 본문을 다시 불러온다.
  const previousStatusRef = useRef<OpenDocumentState>({ id: null, converting: false });
  useEffect(() => {
    const previous = previousStatusRef.current;
    const current = { id: documentId ?? null, status: documentStatus, converting: documentConverting, revision: conversionRevision };
    previousStatusRef.current = current;
    if (shouldReloadOpenDocument(previous, current, noteSaveStatusRef.current === "saved")) {
      setDocumentReloadCount((count) => count + 1);
    }
  }, [documentId, documentStatus, documentConverting, conversionRevision]);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // MarkdownViewer가 memo라 identity를 고정한다. ref만 쓰므로 의존성이 없다.
  const registerBlockRef = useCallback((blockId: string, node: HTMLDivElement | null) => {
    blockRefs.current[blockId] = node;
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolvedPageType = (page?.page_type || pageType || "source").toLowerCase();
  const pageTypeLabel = resolvedPageType === "concept" ? "Concept" : "Source";
  const sourceDocuments = page?.source_documents ?? [];
  const selectedBlockHighlights = useMemo(() => sourceBlockHighlights ?? [], [sourceBlockHighlights]);
  const isMarkdownFile = !pageId && !!documentId && hasMarkdownExtension(title);
  const isPdfOrOther = !pageId && !!documentId && !isMarkdownFile;
  // PDF는 편집 불가 문서라 제목·본문 chrome 없이 얇은 파일명 줄 아래를 뷰어가 채운다.
  const isPdfFile = isPdfOrOther && hasPdfExtension(title);
  const isTextFile = isPdfOrOther && hasTextExtension(title);
  const visibleTitle = isMarkdownFile ? getMarkdownDocumentTitle(title) : title;
  // 자동 저장을 끄면 저장 전 편집분이 남으므로 "저장 안 됨"을 보여 준다(켜져 있으면 곧 저장 중으로 바뀌어 표시하지 않는다).
  const { preferences } = useUserPreferences();
  // 위키 페이지 편집 버튼은 OWNER이거나 wiki.ingest 권한이 있는 멤버에게만 연다(document #130).
  const { role, permissions } = useWorkspaceRole();
  const canEditWiki = canEditWikiPage(role, permissions);
  const saveStatusLabel = noteSaveStatus === "dirty" && !preferences.autoSave
    ? "저장 안 됨 · Cmd/Ctrl+S"
    : SAVE_STATUS_LABELS[noteSaveStatus];
  // 읽기 전용 노트: 저장 상태 대신 배지를 보여주고 편집기를 열지 않는다.
  const isBodyReadOnly = readOnly || bodyLocked;
  const isReadOnlyNote = isMarkdownFile && isBodyReadOnly;
  // 보기 권한이 없으면 권한 안내를, 채팅 Wiki page화 문서면 확인 전용 안내를 보여준다.
  const readOnlyTitle = readOnly ? READ_ONLY_DOCUMENT_TITLE : CHAT_EXPORT_READ_ONLY_TITLE;
  const readOnlyHint = readOnly ? READ_ONLY_DOCUMENT_HINT : CHAT_EXPORT_READ_ONLY_HINT;
  const editableNote = useMemo(() => {
    if (rawMarkdown === null || !documentId) return null;
    const split = splitEditableNoteMarkdown(rawMarkdown) ?? {
      marker: `<!-- fruition-note: ${documentId} -->`,
      body: rawMarkdown
    };
    return { ...split, body: stripPageComments(split.body) };
  }, [documentId, rawMarkdown]);
  // 편집기로 연 이 문서의 편집 제안만 본문에 붙인다.
  const activeEditReview = editReview && isMarkdownFile && !isBodyReadOnly && editableNote && editReview.documentId === documentId
    ? editReview
    : null;

  useEffect(() => {
    setTitleInput(getMarkdownDocumentTitle(title));
    setRenameError(null);
  }, [title]);

  // Cmd+S(macOS) / Ctrl+S(Windows·Linux)로 디바운스를 건너뛰고 즉시 저장한다.
  useEffect(() => {
    if (!isMarkdownFile || !documentId) return;

    function handleSaveKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void noteSaveRef.current?.();
    }

    document.addEventListener("keydown", handleSaveKey);
    return () => document.removeEventListener("keydown", handleSaveKey);
  }, [documentId, isMarkdownFile]);

  // 저장 상태는 문서가 바뀔 때만 되돌린다.
  useEffect(() => {
    noteSaveRef.current = null;
    noteSaveStatusRef.current = "saved";
    setNoteSaveStatus("saved");
    setNoteSaveError(null);
  }, [documentId]);

  const handleMarkdownEditContextChange = useCallback((context: ActiveMarkdownEditContext | null) => {
    onMarkdownEditContextChange?.(context);
  }, [onMarkdownEditContextChange]);

  const handleSaveStatusChange = useCallback((status: NoteSaveStatus, message: string | null) => {
    const previousStatus = noteSaveStatusRef.current;
    noteSaveStatusRef.current = status;
    setNoteSaveStatus(status);
    setNoteSaveError(message);
    if (status === "saved" && previousStatus !== "saved") onRefreshDocuments?.();
  }, [onRefreshDocuments]);

  const handleDetachedSaveComplete = useCallback((result: DetachedNoteSaveResult) => {
    if (result.success) {
      onRefreshDocuments?.();
      return;
    }
    publishNotice({
      kind: "failed",
      title: "노트 저장 실패",
      message: getErrorMessage(result.error, "문서를 이동하는 동안 편집 내용을 저장하지 못했습니다.")
    });
  }, [onRefreshDocuments]);

  async function commitTitle() {
    if (!isMarkdownFile || readOnly || !documentId || !onRenameDocument || isRenaming) return;
    const nextFilename = buildMarkdownDocumentFilename(titleInput, title);
    if (nextFilename === title) {
      setTitleInput(getMarkdownDocumentTitle(title));
      return;
    }
    setIsRenaming(true);
    setRenameError(null);
    try {
      await onRenameDocument(documentId, nextFilename);
    } catch (error) {
      setTitleInput(getMarkdownDocumentTitle(title));
      setRenameError(getErrorMessage(error, "문서 이름을 변경하지 못했습니다."));
    } finally {
      setIsRenaming(false);
    }
  }


  useEffect(() => {
    if (!pageId) {
      setPage(null);
      setErrorMessage(null);
      return;
    }

    let ignore = false;
    setIsLoading(true);
    setErrorMessage(null);

    fetchWikiPage(pageId)
      .then((nextPage) => {
        if (!ignore) setPage(nextPage);
      })
      .catch((error) => {
        if (!ignore) setErrorMessage(getErrorMessage(error, "Wiki page를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [pageId]);

  useEffect(() => {
    if (pageId || !documentId) {
      loadedDocumentIdRef.current = null;
      setRawMarkdown(null);
      setMarkdownLoad(null);
      setNoteContentVersion(0);
      setRawDocumentUrl(null);
      return;
    }

    let ignore = false;
    let objectUrl: string | null = null;
    // 같은 문서를 다시 받는 경우(버전 복원 등)에는 화면을 비우지 않는다.
    // 비우면 본문이 사라졌다가 다시 그려지며 로딩 문구가 뜨고 스크롤이 맨 위로 튄다.
    const isSameDocumentReload = loadedDocumentIdRef.current === documentId;
    setErrorMessage(null);
    if (!isSameDocumentReload) {
      setIsLoading(true);
      setRawMarkdown(null);
      setMarkdownLoad(null);
      setNoteContentVersion(0);
      setRawDocumentUrl(null);
      setRawText(null);
    }

    const loadDocument = async () => {
      if (isMarkdownFile) {
        await waitForPendingDocumentSave(documentId);
        if (ignore) return;
        const draft = await fetchNoteDraft(documentId);
        if (draft) {
          if (!ignore) {
            setRawMarkdown(draft.markdown);
            setMarkdownLoad(nextMarkdownLoad(documentId));
            setNoteContentVersion(draft.content_version);
          }
          return;
        }
        const blob = await fetchDocumentOriginal(documentId);
        const text = await blob.text();
        if (!ignore) {
          setRawMarkdown(text);
          setMarkdownLoad(nextMarkdownLoad(documentId));
          setNoteContentVersion(0);
        }
        return;
      }

      // PDF는 브라우저 내장 뷰어(iframe)로 연다. 임시 읽기 URL이 있으면 그대로 쓰고(다운로드 파일명 유지),
      // 없으면 인증 프록시로 받은 원본을 blob URL로 넘긴다.
      if (isPdfFile) {
        // 임시 URL 조회가 실패해도(엔드포인트 미지원 등) 프록시 원본으로 계속 연다.
        const url = await fetchDocumentReadUrl(documentId).catch(() => null);
        if (url) {
          if (!ignore) setRawDocumentUrl(url);
          return;
        }
      }
      const blob = await fetchDocumentOriginal(documentId);
      if (!isPdfFile && (isTextFile || blob.type.startsWith("text/"))) {
        const text = await blob.text();
        if (!ignore) setRawText(text);
        return;
      }
      // PDF는 브라우저 내장 뷰어로 연다. 응답 MIME이 PDF가 아니면 iframe이 그리지 않고 내려받으므로 타입을 맞춘다.
      const viewBlob = isPdfFile && blob.type !== "application/pdf"
        ? new Blob([blob], { type: "application/pdf" })
        : blob;
      objectUrl = URL.createObjectURL(viewBlob);
      if (ignore) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        return;
      }
      setRawDocumentUrl(objectUrl);
    };

    void loadDocument()
      .catch((error: unknown) => {
        if (!ignore) setErrorMessage(getErrorMessage(error, "문서를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (ignore) return;
        loadedDocumentIdRef.current = documentId;
        setIsLoading(false);
      });

    return () => {
      ignore = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, documentReloadCount, isMarkdownFile, isPdfFile, isTextFile, nextMarkdownLoad, pageId]);

  // 근거 block ID는 영구 ID라 본문을 다시 잘라 순번을 매기면 어긋난다(#65). 서버 block 위치를 받아 맞춘다.
  // 본문을 불러온 뒤에 그 본문 버전 키로 조회해, 복원·재편입 전 응답을 새 본문에 적용하지 않게 한다.
  const isBlocksQueryEnabled = isMarkdownFile
    && !!documentId
    && markdownLoad?.documentId === documentId
    && selectedBlockHighlights.length > 0;
  const blocksQuery = useQuery(
    getSourceBlocksQueryOptions(documentId, markdownLoad, isBlocksQueryEnabled, fetchDocumentBlocks)
  );
  // 응답을 요청한 로드가 현재 본문 로드일 때만 서버 줄 범위를 믿는다.
  const currentBlocks = useMemo(
    () => selectSourceBlocksForLoad(markdownLoad, blocksQuery.data),
    [blocksQuery.data, markdownLoad]
  );
  const resolvedHighlight = useMemo(() => resolveHighlightRanges(
    rawMarkdown,
    currentBlocks,
    selectedBlockHighlights.map((highlight) => highlight.block_id)
  ), [currentBlocks, rawMarkdown, selectedBlockHighlights]);
  const { isLoading: isBlocksLoading, notice: highlightNotice } = getSourceHighlightStatus(
    {
      isEnabled: isBlocksQueryEnabled,
      isPending: blocksQuery.isPending,
      isError: blocksQuery.isError,
      ...currentBlocks
    },
    resolvedHighlight
  );
  const highlightRanges = useMemo(() => resolvedHighlight?.ranges ?? [], [resolvedHighlight]);
  // 위치를 찾은 근거만 스크롤 대상으로 삼는다. 첫 근거가 빠져도 다음 근거로 이동한다.
  const locatedHighlights = useMemo(() => {
    const locatedIds = new Set(highlightRanges.map((range) => range.blockId));
    return selectedBlockHighlights.filter((highlight) => locatedIds.has(highlight.block_id));
  }, [highlightRanges, selectedBlockHighlights]);
  // 근거를 새로 고르거나 스크롤 대상이 실제로 바뀔 때만 다시 스크롤한다.
  // placeholder→실응답처럼 같은 위치로 재계산되면 사용자 스크롤을 되돌리지 않는다.
  const scrollTargetBlockId = locatedHighlights[0]?.block_id ?? null;
  const scrollTargetKey = getHighlightScrollKey(highlightRanges, locatedHighlights);

  // 하이라이트 본문 렌더와 스크롤 effect가 같은 조건을 보게 한다.
  // 본문과 로딩 종료가 다른 렌더로 나뉘면, 블록이 그려지기 전에 스크롤을 시도하고 끝나 버린다.
  // 근거 위치 조회도 끝나야 하이라이트 블록이 그려지므로 로딩으로 함께 본다.
  const showHighlightedMarkdown = canShowHighlightedMarkdown({
    isMarkdownFile,
    isLoading: isLoading || isBlocksLoading,
    errorMessage,
    rawMarkdown,
    highlightCount: selectedBlockHighlights.length
  });

  useEffect(() => {
    if (!showHighlightedMarkdown || renderedMarkdownLoad !== markdownLoad) return;

    // scrollIntoView는 조상 요소·페이지까지 밀 수 있어(#64) 미리보기 스크롤 영역만 직접 스크롤한다.
    const frameId = window.requestAnimationFrame(() => {
      const block = findHighlightedScrollTarget(
        blockRefs.current,
        scrollTargetBlockId ? [{ block_id: scrollTargetBlockId }] : []
      );
      const container = contentRef.current;
      if (!block || !container) return;
      const containerRect = container.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      container.scrollTo({
        top: getCenteredScrollTop(
          {
            top: containerRect.top + container.clientTop,
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight
          },
          { top: blockRect.top, height: blockRect.height }
        )
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [showHighlightedMarkdown, renderedMarkdownLoad, markdownLoad, rawMarkdown, selectedBlockHighlights, scrollTargetBlockId, scrollTargetKey]);

  return (
    <section
      className={cx(styles["source-preview-panel"], fillMain && styles["is-main"])}
      aria-label="원본문서 미리보기"
      onClick={(event) => event.stopPropagation()}
    >
      {/* 콘텐츠 상단 제목 바 대신, 저장 상태를 콘텐츠 우상단에 작게 띄운다.
          제목(위 48px)보다 위쪽 여백에 놓여 제목 줄과 겹치지 않는다. PDF는 아래 파일명 줄이 이 자리를 맡는다. */}
      {!isPdfFile && (
        <div className={styles["source-preview-actions"]}>
          {isReadOnlyNote && (
            <span className={styles["source-preview-readonly-badge"]} title={`${readOnlyTitle}\n${readOnlyHint}`}>읽기 전용</span>
          )}
          {!isReadOnlyNote && saveStatusLabel && (
            <span
              className={cx(styles["source-preview-save-status"], styles[`is-${noteSaveStatus}`])}
              role={noteSaveStatus === "saving" ? "status" : "alert"}
              title={noteSaveError ?? undefined}
            >
              {saveStatusLabel}
            </span>
          )}
        </div>
      )}
      <div className={cx(styles["source-preview-document"], isPdfFile && styles["is-pdf"])}>
        {(isLoading || isBlocksLoading) && <DocumentLoading detail={isMarkdownFile ? "본문을 받은 뒤 표·수식을 포함한 문서 화면을 준비합니다." : undefined}>{pageId ? "본문을 불러오는 중입니다." : "문서를 불러오는 중입니다."}</DocumentLoading>}
        {isPdfFile ? (
          <>
            {/* 제목 바가 없으므로 PDF 뷰어 위에 파일명 줄을 둔다. */}
            <header className={styles["source-preview-file-bar"]}>
              <span title={titleHint ?? visibleTitle}>{withPathSuffix(visibleTitle, titleSuffix)}</span>
            </header>
            {errorMessage && <p>{errorMessage}</p>}
            {!isLoading && !errorMessage && rawDocumentUrl && (
              <iframe
                referrerPolicy="no-referrer"
                src={rawDocumentUrl}
                title={title}
                className={styles["source-preview-pdf-frame"]}
              />
            )}
          </>
        ) : (
        <div ref={contentRef} className={styles["source-preview-content"]}>
        {isReadOnlyNote && (
          <p className={styles["source-preview-readonly-notice"]} role="status">
            <span>{readOnlyTitle}</span>
            <span>{readOnlyHint}</span>
          </p>
        )}
        {!isBodyReadOnly && isMarkdownFile && !documentConverting && editorReadOnlyNotice?.documentId === documentId && editorReadOnlyNotice.message && (
          <p className={styles["source-preview-lock-notice"]} role="alert">{editorReadOnlyNotice.message}</p>
        )}
        <header className={styles["source-preview-heading"]}>
          {isMarkdownFile ? (
            // 제안 배지가 붙으면 제목 칸을 글자 폭에 맞춰 배지를 제목 바로 옆에 둔다(Figma 1610:2850).
            <div className={cx(styles["source-preview-title-field"], activeEditReview && styles["is-fit"])} data-value={titleInput || "제목을 입력하세요"}>
            <input
              className={styles["source-preview-title-input"]}
              aria-label="문서 이름"
              title={readOnly ? "보기 권한만 있는 문서는 이름을 바꿀 수 없습니다." : titleHint}
              placeholder="제목을 입력하세요"
              value={titleInput}
              disabled={isRenaming}
              readOnly={readOnly}
              spellCheck={false}
              onChange={(event) => {
                skipNextTitleCommitRef.current = false;
                setTitleInput(event.target.value);
              }}
              onBlur={() => {
                if (skipNextTitleCommitRef.current) {
                  skipNextTitleCommitRef.current = false;
                  return;
                }
                void commitTitle();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  skipNextTitleCommitRef.current = true;
                  setTitleInput(visibleTitle);
                  event.currentTarget.blur();
                }
              }}
            />
            </div>
          ) : (
            <h2 title={titleHint}>{withPathSuffix(visibleTitle, titleSuffix)}</h2>
          )}
          {/* 이름을 고치는 입력칸에는 경로를 섞을 수 없어 Markdown은 접미사를 옆에 따로 둔다. */}
          {isMarkdownFile && titleSuffix && (
            <span className={styles["source-preview-title-suffix"]} title={titleHint}>· {titleSuffix}</span>
          )}
          {activeEditReview && <EditProposalBadge count={activeEditReview.pendingCount} />}
          {!fillMain && <span>{pageId ? pageTypeLabel : editableNote ? "Note" : "Raw"}</span>}
        </header>
        {isMarkdownFile && renameError && (
          <div className={styles["source-preview-document-controls"]}>
            <span role="alert">{renameError}</span>
          </div>
        )}
        {isMarkdownFile && errorMessage && <p>{errorMessage}</p>}
        {showHighlightedMarkdown && rawMarkdown !== null && (
          <>
            {highlightNotice && (
              <div className={styles["source-preview-document-controls"]}>
                <span role="status">{highlightNotice}</span>
              </div>
            )}
            <MarkdownViewer
              markdown={rawMarkdown}
              highlightedBlocks={selectedBlockHighlights}
              highlightRanges={highlightRanges}
              onBlockRef={registerBlockRef}
              onReady={handleMarkdownReady}
            />
          </>
        )}
        {isMarkdownFile && documentConversion && !isLoading && !errorMessage && rawMarkdown !== null && selectedBlockHighlights.length === 0 && (
          <>
            <div className={styles["source-preview-document-controls"]}>
              <span role="status">{getConversionNotice(documentConversion)}</span>
            </div>
            <MarkdownViewer markdown={rawMarkdown} />
          </>
        )}
        {isReadOnlyNote && !documentConverting && !isLoading && !errorMessage && rawMarkdown !== null && selectedBlockHighlights.length === 0 && editableNote && (
          <>
            <MarkdownViewer markdown={editableNote.body} />
          </>
        )}
        {activeEditReview && <InlineEditReview review={activeEditReview} />}
        {isMarkdownFile && !isBodyReadOnly && !documentConverting && !isLoading && !errorMessage && rawMarkdown !== null && selectedBlockHighlights.length === 0 && editableNote && documentId && (
          // 검토 중에는 편집기를 숨기되 마운트해 둔다. 수락하면 이 편집기로 적용·저장한다.
          <div className={styles["source-preview-editor-slot"]} hidden={Boolean(activeEditReview)}>
          <DynamicNoteEditor
            key={`${documentId}:${documentReloadCount}:${noteContentVersion}`}
            documentId={documentId}
            marker={editableNote.marker}
            initialBody={editableNote.body}
            initialVersion={noteContentVersion}
            onMarkdownEditContextChange={handleMarkdownEditContextChange}
            onSaveStatusChange={handleSaveStatusChange}
            onDetachedSaveComplete={handleDetachedSaveComplete}
            onRegisterSave={registerNoteSave}
            onReadOnlyNoticeChange={handleReadOnlyNoticeChange}
          />
          </div>
        )}
        {isPdfOrOther && errorMessage && <p>{errorMessage}</p>}
        {isPdfOrOther && !isLoading && !errorMessage && rawText !== null && (
          <pre className={styles["source-preview-plain-text"]}>{rawText}</pre>
        )}
        {isPdfOrOther && !isLoading && !errorMessage && rawText === null && rawDocumentUrl && (
          <iframe
                referrerPolicy="no-referrer"
            src={rawDocumentUrl}
            title={title}
            className="source-preview-iframe"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        )}
        {pageId && errorMessage && <p>{errorMessage}</p>}
        {pageId && !isLoading && !errorMessage && page?.markdown && (
          <WikiPageContent page={page} canEdit={canEditWiki} onPageChange={setPage} onSaved={onRefreshDocuments} />
        )}
        {pageId && !isLoading && !errorMessage && !page?.markdown && page?.summary && <p>{page.summary}</p>}
        {pageId && !isLoading && !errorMessage && page && !page.markdown && (
          <p>본문 markdown을 찾지 못했습니다. 연결된 원본 문서 정보만 표시합니다.</p>
        )}
        {pageId && !isLoading && !errorMessage && sourceDocuments.length > 0 && (
          <div className={styles["source-preview-meta"]}>
            <strong>원본 문서</strong>
            {sourceDocuments.map((document) => (
              <span key={document.id}>{document.filename || document.id}</span>
            ))}
          </div>
        )}
        {!pageId && !documentId && <p>연결된 Wiki page가 없는 항목입니다.</p>}
        </div>
        )}
      </div>
    </section>
  );
}
