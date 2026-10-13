import type { DocumentItemResponse } from "@/entities/document";
import { cx } from "@/shared/lib/classNames";
import { RailButton, RailGroup } from "@/widgets/rail-navigation/ui/RailNavigation";
import { RailIngestIcon, RailRefreshIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { useGraphWikiStatus } from "../model/useGraphWikiStatus";
import styles from "./DocumentSidebar.module.css";

/**
 * 그래프 뷰 레일의 위키 편입·위키 최신화 버튼 (Figma 1486:4377).
 * 위키 편입은 사이드바 트리를 문서 선택 모드로 바꾸고, 확정은 사이드바 하단 바에서 한다.
 */
export function GraphRailActions({
  documents,
  pending,
  isSelecting,
  onToggleSelecting,
  onLint
}: {
  documents: DocumentItemResponse[];
  pending: "ingest" | "lint" | null;
  isSelecting: boolean;
  onToggleSelecting: () => void;
  onLint: () => void;
}) {
  const { isLintActive, isLintEnabled, lintHint, isMaintenanceStatusError, refetchMaintenanceStatus } =
    useGraphWikiStatus({ documents, pending });
  const isIngestDisabled = !isSelecting && (pending !== null || isLintActive);
  // 말풍선 보조줄: 선택 중이면 취소 단축키, 막혀 있으면 짧은 사유
  const ingestHint = isSelecting
    ? <kbd>Esc</kbd>
    : isIngestDisabled
      ? (pending === "ingest" ? "진행 중이에요" : "최신화 중에는 할 수 없어요")
      : null;

  return (
    <RailGroup>
      <RailButton
        label={pending === "ingest" ? "위키 편입 중" : "위키 편입"}
        tooltip={isSelecting ? "선택 취소" : "위키 편입"}
        tooltipHint={ingestHint}
        isActive={isSelecting}
        aria-pressed={isSelecting}
        // 선택 중에는 진행 상태와 관계없이 다시 눌러 선택을 끌 수 있어야 한다.
        disabled={isIngestDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelecting();
        }}
      >
        <RailIngestIcon />
      </RailButton>
      <RailButton
        label={isMaintenanceStatusError ? "위키 최신화 상태 재확인" : "위키 최신화"}
        tooltip="위키 최신화"
        tooltipHint={isSelecting ? "문서 선택 중에는 할 수 없어요" : lintHint}
        className={cx(pending === "lint" && styles["is-spinning"])}
        disabled={isSelecting || (!isLintEnabled && !isMaintenanceStatusError)}
        onClick={(event) => {
          event.stopPropagation();
          if (isMaintenanceStatusError) {
            void refetchMaintenanceStatus();
            return;
          }
          onLint();
        }}
      >
        <RailRefreshIcon />
      </RailButton>
    </RailGroup>
  );
}
