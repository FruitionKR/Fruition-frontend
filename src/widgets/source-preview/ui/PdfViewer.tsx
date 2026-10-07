"use client";

import { ChevronDown, ChevronUp, Minus, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EventBus, PDFViewer as PdfJsViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { fetchDocumentOriginal } from "@/entities/document";
import { getErrorMessage } from "@/shared/lib/errors";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";
import styles from "./PdfViewer.module.css";

type PdfViewerProps = {
  documentId: string;
  /** 값이 바뀌면 원본을 다시 받아 그린다(버전 복원 등). */
  reloadKey: number;
  title: string;
};

type MatchesCount = { current: number; total: number };

// pdf.js FindState.PENDING. 상수 때문에 뷰어 모듈을 정적으로 불러오지 않도록 값만 둔다.
const FIND_STATE_PENDING = 3;
const EMPTY_MATCHES: MatchesCount = { current: 0, total: 0 };

/**
 * pdf.js 기반 PDF 뷰어. 브라우저 내장 뷰어(iframe)는 Ctrl+F가 앱 전체를 검색하므로,
 * 텍스트 레이어와 검색 하이라이트를 이 컨테이너 안에서만 그리고 검색 UI는 앱이 제공한다(#107).
 * 원본은 S3 presigned URL 대신 인증 프록시(/original)로 받아 CORS 설정 없이 연다.
 */
export function PdfViewer({ documentId, reloadKey, title }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const pdfViewerRef = useRef<PdfJsViewer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pagesCount, setPagesCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MatchesCount>(EMPTY_MATCHES);
  const [isSearchPending, setIsSearchPending] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) return;

    let ignore = false;
    let destroyDocument: (() => void) | null = null;
    setIsLoading(true);
    setErrorMessage(null);
    setPageNumber(1);
    setPagesCount(0);
    setMatches(EMPTY_MATCHES);

    const load = async () => {
      // pdf.js는 PDF를 열 때만 불러온다. 뷰어 모듈은 globalThis.pdfjsLib를 읽으므로 본체를 먼저 불러온다.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const { EventBus, PDFFindController, PDFLinkService, PDFViewer } = await import("pdfjs-dist/web/pdf_viewer.mjs");
      const blob = await fetchDocumentOriginal(documentId);
      const data = new Uint8Array(await blob.arrayBuffer());
      if (ignore) return;

      const eventBus = new EventBus();
      const linkService = new PDFLinkService({ eventBus });
      const findController = new PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true });
      // 페이지는 화면 근처만 그리는 PDFViewer 기본 지연 렌더를 쓴다.
      const pdfViewer = new PDFViewer({ container, viewer, eventBus, linkService, findController, removePageBorders: true });
      linkService.setViewer(pdfViewer);
      eventBus.on("pagesinit", () => {
        pdfViewer.currentScaleValue = "page-width";
      });
      eventBus.on("pagechanging", ({ pageNumber: next }: { pageNumber: number }) => setPageNumber(next));
      eventBus.on("scalechanging", ({ scale: next }: { scale: number }) => setScale(next));
      eventBus.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: MatchesCount }) => setMatches(matchesCount));
      eventBus.on("updatefindcontrolstate", ({ state, matchesCount }: { state: number; matchesCount: MatchesCount }) => {
        setIsSearchPending(state === FIND_STATE_PENDING);
        setMatches(matchesCount);
      });

      const loadingTask = pdfjs.getDocument({ data });
      destroyDocument = () => {
        pdfViewer.setDocument(null);
        linkService.setDocument(null);
        void loadingTask.destroy();
      };
      const pdfDocument = await loadingTask.promise;
      if (ignore) return;
      pdfViewer.setDocument(pdfDocument);
      linkService.setDocument(pdfDocument);
      eventBusRef.current = eventBus;
      pdfViewerRef.current = pdfViewer;
      setPagesCount(pdfDocument.numPages);
    };

    void load()
      .catch((error: unknown) => {
        if (!ignore) setErrorMessage(getErrorMessage(error, "PDF를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
      eventBusRef.current = null;
      pdfViewerRef.current = null;
      destroyDocument?.();
    };
  }, [documentId, reloadKey]);

  const dispatchFind = (nextQuery: string, type: "" | "again", findPrevious = false) => {
    if (!nextQuery) {
      eventBusRef.current?.dispatch("findbarclose", { source: null });
      setMatches(EMPTY_MATCHES);
      setIsSearchPending(false);
      return;
    }
    eventBusRef.current?.dispatch("find", {
      source: null,
      type,
      query: nextQuery,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
      matchDiacritics: false
    });
  };

  const openSearch = () => {
    setIsSearchOpen(true);
    // 이미 열려 있으면 입력값을 선택해 바로 새 검색어를 칠 수 있게 한다.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  };

  const closeSearch = () => {
    setIsSearchOpen(false);
    setQuery("");
    dispatchFind("", "");
    containerRef.current?.focus();
  };

  // PDF 영역에 포커스가 있을 때 Ctrl/Cmd+F는 브라우저 찾기(앱 전체 검색) 대신 PDF 검색을 연다.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
    }
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      dispatchFind(query, "again", event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  };

  const isReady = !isLoading && !errorMessage;
  const hasQuery = query.length > 0;

  return (
    <section className={styles["pdf-viewer"]} aria-label={title} onKeyDown={handleKeyDown}>
      <div className={styles["pdf-toolbar"]} role="toolbar" aria-label="PDF 도구">
        <span className={styles["pdf-page-indicator"]} aria-live="polite">
          {pagesCount > 0 ? `${pageNumber} / ${pagesCount}` : "-"}
        </span>
        <div className={styles["pdf-toolbar-group"]}>
          <button
            type="button"
            className={styles["pdf-icon-button"]}
            aria-label="축소"
            disabled={!isReady}
            onClick={() => pdfViewerRef.current?.decreaseScale()}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className={styles["pdf-scale"]}>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className={styles["pdf-icon-button"]}
            aria-label="확대"
            disabled={!isReady}
            onClick={() => pdfViewerRef.current?.increaseScale()}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles["pdf-icon-button"]}
            aria-label="PDF에서 검색"
            aria-pressed={isSearchOpen}
            disabled={!isReady}
            onClick={() => (isSearchOpen ? closeSearch() : openSearch())}
          >
            <Search size={16} aria-hidden="true" />
          </button>
        </div>
        {isSearchOpen && (
          <div className={styles["pdf-search"]} role="search">
            <input
              ref={searchInputRef}
              className={styles["pdf-search-input"]}
              type="search"
              aria-label="PDF 본문 검색"
              placeholder="PDF에서 검색"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                dispatchFind(event.target.value, "");
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <span className={styles["pdf-search-count"]} aria-live="polite">
              {hasQuery && !isSearchPending ? `${matches.current}/${matches.total}` : ""}
            </span>
            <button
              type="button"
              className={styles["pdf-icon-button"]}
              aria-label="이전 결과"
              disabled={!hasQuery || matches.total === 0}
              onClick={() => dispatchFind(query, "again", true)}
            >
              <ChevronUp size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles["pdf-icon-button"]}
              aria-label="다음 결과"
              disabled={!hasQuery || matches.total === 0}
              onClick={() => dispatchFind(query, "again")}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <button type="button" className={styles["pdf-icon-button"]} aria-label="검색 닫기" onClick={closeSearch}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className={styles["pdf-stage"]}>
        {/* PDFViewer는 container가 absolute로 배치되어 있어야 한다. */}
        <div ref={containerRef} className={styles["pdf-scroll"]} tabIndex={0} aria-label="PDF 본문">
          <div ref={viewerRef} className="pdfViewer" />
        </div>
        {isLoading && <DocumentLoading>문서를 불러오는 중입니다.</DocumentLoading>}
        {errorMessage && <p className={styles["pdf-error"]}>{errorMessage}</p>}
      </div>
    </section>
  );
}
