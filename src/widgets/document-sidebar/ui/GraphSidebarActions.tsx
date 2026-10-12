import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import { useEscapeLayer } from "@/shared/lib/useEscapeLayer";
import { getGraphIngestBlockReason } from "@/features/wiki-ingest/model/graphDocuments";
import type { DocumentItemResponse } from "@/entities/document";
import type { Project } from "@/entities/tree";
import { plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { RailIngestIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { toggleDocumentIds } from "../model/wikiIngestSelection";
import { WikiIngestTree } from "./WikiIngestTree";
import { HoverHint } from "@/shared/ui/HoverHint";
import styles from "./DocumentSidebar.module.css";

/**
 * 그래프 뷰 사이드바 (Figma 1406:13761).
 * 기본 모드는 홈과 같은 문서 트리이고, 위키 편입·위키 최신화 버튼은 좌측 레일(GraphRailActions)에 있다.
 * 레일의 위키 편입을 누르면 체크박스 트리로 바뀌고, 하단 [위키 편입 (n)][취소] 바로 확정한다.
 * 선택 트리는 PDF를 숨긴 그래프 트리가 아니라 원래 폴더 구조 전체를 보여 준다.
 */
export function GraphSidebarActions({
  documents,
  pending,
  projects,
  tree,
  isSelecting,
  onExitSelecting,
  onIngestDocuments
}: {
  /** 워크스페이스 전체 문서(PDF 포함). 선택 가능 여부 판정에 쓴다. */
  documents: DocumentItemResponse[];
  pending: "ingest" | "lint" | null;
  /** 선택 모드 트리에 보여줄 원래 폴더 구조(PDF·TXT·빈 폴더 포함). */
  projects: Project[];
  /** 기본 모드에서 보여줄 문서 트리(홈 뷰와 동일한 RootTree). */
  tree: ReactNode;
  /** 레일의 위키 편입 버튼으로 켜는 문서 선택 모드 */
  isSelecting: boolean;
  onExitSelecting: () => void;
  /** 선택 모드에서 고른 문서들을 한 번에 위키에 반영한다. 변환 전 PDF가 섞일 수 있다. */
  onIngestDocuments: (documents: DocumentItemResponse[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const blockReasons = useMemo(
    () => new Map(documents.map((document) => [document.id, getGraphIngestBlockReason(document, documents)])),
    [documents]
  );
  const selectedDocuments = documents.filter(
    (document) => selectedIds.has(document.id) && blockReasons.get(document.id) === null
  );

  // 선택 모드를 벗어나면(레일 버튼·Esc·확정) 고른 문서를 비운다.
  useEffect(() => {
    if (!isSelecting) setSelectedIds(new Set());
  }, [isSelecting]);

  // 선택 모드는 Esc로도 빠져나온다. 모달·메뉴가 열려 있으면 그 레이어가 먼저 닫힌다.
  const exitSelecting = useCallback(() => onExitSelecting(), [onExitSelecting]);
  useEscapeLayer(isSelecting, exitSelecting, "fallback");

  function confirmSelection() {
    if (selectedDocuments.length === 0) return;
    onIngestDocuments(selectedDocuments);
    onExitSelecting();
  }

  return (
    <div className={styles["graph-panel"]}>
      <div className={styles["graph-panel-tree"]}>
        {isSelecting ? (
          <WikiIngestTree
            projects={projects}
            blockReasons={blockReasons}
            selectedIds={selectedIds}
            onToggle={(ids) => setSelectedIds((current) => toggleDocumentIds(current, ids))}
          />
        ) : tree}
      </div>

      {isSelecting && (
        <div className={styles["graph-bottom"]}>
          <HoverHint
            className={styles["graph-pill-hint"]}
            text="선택한 문서를 위키에 편입합니다. 변환 전 PDF는 확인 후 Markdown으로 변환해 편입합니다."
          >
          <button
            type="button"
            className={styles["graph-pill"]}
            disabled={pending !== null || selectedDocuments.length === 0}
            onClick={(event) => {
              event.stopPropagation();
              confirmSelection();
            }}
          >
            {/* 기존 ingest.svg는 다크 전용 색이라 테마를 따르는 레일 아이콘을 쓴다. */}
            <RailIngestIcon className={styles["graph-pill-icon"]} />
            {`위키 편입 (${selectedDocuments.length})`}
          </button>
          </HoverHint>
          <HoverHint align="end" text="선택을 취소하고 문서 목록으로 돌아갑니다. (Esc)">
          <button
            type="button"
            className={cx(styles["graph-pill"], styles["is-round"])}
            aria-label="선택 취소"
            onClick={(event) => {
              event.stopPropagation();
              onExitSelecting();
            }}
          >
            <SvgIcon src={plusIcon} className={styles["graph-cancel-icon"]} />
          </button>
          </HoverHint>
        </div>
      )}
    </div>
  );
}
