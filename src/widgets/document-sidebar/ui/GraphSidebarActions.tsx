import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cx } from "@/shared/lib/classNames";
import { formatLintProgressLabel } from "@/features/wiki-ingest/model/activeLintOperation";
import {
  isLintActionEnabled,
  selectActiveIngestDocuments
} from "@/features/wiki-ingest/model/wikiReflectState";
import { useActiveLintOperation } from "@/features/wiki-ingest/model/useActiveLintOperation";
import { isGraphIngestEligible } from "@/features/wiki-ingest/model/graphDocuments";
import { fetchWikiMaintenanceStatus } from "@/features/document-notifications";
import type { DocumentItemResponse } from "@/entities/document";
import type { Project } from "@/entities/tree";
import { ingestIcon, plusIcon, refreshIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { toggleDocumentIds } from "../model/wikiIngestSelection";
import { WikiIngestTree } from "./WikiIngestTree";
import { HoverHint } from "@/shared/ui/HoverHint";
import styles from "./DocumentSidebar.module.css";

/**
 * 그래프 뷰 사이드바 (Figma 1027:8099 / 1027:6233).
 * 기본 모드는 홈과 같은 문서 트리 + 하단 [위키 편입][Lint] pill.
 * 위키 편입을 누르면 체크박스 트리로 바뀌고, 같은 버튼이 확정 버튼이 된다.
 */
export function GraphSidebarActions({
  documents,
  pending,
  projects,
  tree,
  onIngestDocuments,
  onLint
}: {
  documents: DocumentItemResponse[];
  pending: "ingest" | "lint" | null;
  projects: Project[];
  /** 기본 모드에서 보여줄 문서 트리(홈 뷰와 동일한 ProjectSection). */
  tree: ReactNode;
  /** 선택 모드에서 고른 문서들을 한 번에 위키에 반영한다. */
  onIngestDocuments: (documents: DocumentItemResponse[]) => void;
  onLint: () => void;
}) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const eligibleDocumentIds = useMemo(
    () => new Set(documents.filter(isGraphIngestEligible).map((document) => document.id)),
    [documents]
  );
  const selectedDocuments = documents.filter(
    (document) => selectedIds.has(document.id) && eligibleDocumentIds.has(document.id)
  );

  const activeIngestDocuments = selectActiveIngestDocuments(documents);
  const activeLintOperation = useActiveLintOperation(pending === "lint");
  const lintProgressLabel = formatLintProgressLabel(activeLintOperation, pending === "lint");
  const isIngestActive = pending === "ingest" || activeIngestDocuments.length > 0;
  const isLintActive = lintProgressLabel !== null;
  const {
    data: maintenanceStatus,
    isError: isMaintenanceStatusError,
    isFetching: isMaintenanceStatusFetching,
    refetch: refetchMaintenanceStatus
  } = useQuery({
    queryKey: ["wikiMaintenanceStatus"],
    queryFn: fetchWikiMaintenanceStatus,
    refetchInterval: isIngestActive ? 3000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false
  });
  const previousWorkRef = useRef({ isIngestActive, isLintActive });

  useEffect(() => {
    const previous = previousWorkRef.current;
    previousWorkRef.current = { isIngestActive, isLintActive };
    if ((previous.isIngestActive && !isIngestActive) || (previous.isLintActive && !isLintActive)) {
      void refetchMaintenanceStatus();
    }
  }, [isIngestActive, isLintActive, refetchMaintenanceStatus]);

  // 선택 모드는 Esc로도 빠져나온다.
  useEffect(() => {
    if (!isSelecting) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsSelecting(false);
      setSelectedIds(new Set());
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelecting]);

  const isLintEnabled = isLintActionEnabled({
    needsLint: maintenanceStatus?.needs_lint === true,
    isIngestActive,
    isLintActive
  });
  const lintTitle = isMaintenanceStatusError
    ? "위키 최신화 가능 상태를 불러오지 못했습니다. 클릭해서 다시 확인하세요."
    : isIngestActive
      ? "위키 편입이 끝난 뒤 최신화할 수 있습니다."
      : isMaintenanceStatusFetching
        ? "위키 최신화 가능 상태를 확인하고 있습니다."
        : maintenanceStatus?.needs_lint === false
          ? "새로 편입된 내용이 없어 최신화할 것이 없습니다."
          : pending === "lint"
            ? "위키 최신화 진행 중"
            : "편입된 문서를 바탕으로 위키 페이지를 최신 상태로 정리합니다.";

  function exitSelection() {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }

  function confirmSelection() {
    if (selectedDocuments.length === 0) return;
    onIngestDocuments(selectedDocuments);
    exitSelection();
  }

  return (
    <div className={styles["graph-panel"]}>
      <div className={styles["graph-panel-tree"]}>
        {isSelecting ? (
          <WikiIngestTree
            projects={projects}
            eligibleDocumentIds={eligibleDocumentIds}
            selectedIds={selectedIds}
            onToggle={(ids) => setSelectedIds((current) => toggleDocumentIds(current, ids))}
          />
        ) : tree}
      </div>

      <div className={styles["graph-bottom"]}>
        <HoverHint
          className={styles["graph-pill-hint"]}
          text={isSelecting
            ? "선택한 문서를 위키에 편입합니다. PDF는 확인 후 Markdown으로 변환합니다."
            : "편입할 PDF·Markdown 문서 또는 폴더를 선택합니다."}
        >
        <button
          type="button"
          className={styles["graph-pill"]}
          disabled={pending !== null || isLintActive || (isSelecting && selectedDocuments.length === 0)}
          onClick={(event) => {
            event.stopPropagation();
            if (isSelecting) confirmSelection();
            else setIsSelecting(true);
          }}
        >
          <SvgIcon src={ingestIcon} />
          {isSelecting
            ? `위키 편입 (${selectedDocuments.length})`
            : pending === "ingest"
              ? "위키 편입 중…"
              : "위키 편입"}
        </button>
        </HoverHint>
        {isSelecting ? (
          <HoverHint align="end" text="선택을 취소하고 문서 목록으로 돌아갑니다. (Esc)">
          <button
            type="button"
            className={cx(styles["graph-pill"], styles["is-round"])}
            aria-label="선택 취소"
            onClick={(event) => {
              event.stopPropagation();
              exitSelection();
            }}
          >
            <SvgIcon src={plusIcon} className={styles["graph-cancel-icon"]} />
          </button>
          </HoverHint>
        ) : (
          <HoverHint align="end" text={lintTitle}>
          <button
            type="button"
            className={cx(styles["graph-pill"], styles["is-round"], pending === "lint" && styles["is-spinning"])}
            disabled={!isLintEnabled && !isMaintenanceStatusError}
            aria-label={isMaintenanceStatusError ? "위키 최신화 상태 재확인" : "위키 최신화"}
            onClick={(event) => {
              event.stopPropagation();
              if (isMaintenanceStatusError) {
                void refetchMaintenanceStatus();
                return;
              }
              onLint();
            }}
          >
            <SvgIcon src={refreshIcon} />
          </button>
          </HoverHint>
        )}
      </div>
    </div>
  );
}
