import type { DocumentItemResponse } from "@/entities/document";
import { useWorkspaceRole } from "@/entities/workspace";
import { hasWorkspacePermission } from "@/shared/lib/workspacePermissions";
import { cx } from "@/shared/lib/classNames";
import { RailButton, RailGroup } from "@/widgets/rail-navigation/ui/RailNavigation";
import { RailIngestIcon, RailRefreshIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { useGraphWikiStatus } from "../model/useGraphWikiStatus";
import {
  getIngestIndicator,
  getLintIndicator,
  selectPendingIngestDocuments,
  WIKI_INGEST_PERMISSION_HINT,
  WIKI_LINT_PERMISSION_HINT
} from "../model/wikiActionIndicators";
import styles from "./DocumentSidebar.module.css";

/**
 * 그래프 뷰 레일의 위키 편입·위키 최신화 버튼 (Figma 1486:4377).
 * 위키 편입은 사이드바 트리를 문서 선택 모드로 바꾸고, 확정은 사이드바 하단 바에서 한다.
 * 편입할 문서가 있거나 최신화가 필요하면 버튼에 주황 점을 켜고 말풍선에 이유를 보여 준다.
 * 위키 편입(wiki.ingest)·위키 최신화(wiki.lint) 권한이 없는 MEMBER에게는 점을 끄고 버튼을 막은 채 말풍선에 사유를 보여 준다.
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
  const workspaceRole = useWorkspaceRole();
  // 역할 확인 중(null)에는 막지 않는다. 최종 판단은 서버 403이다.
  const isIngestForbidden = hasWorkspacePermission(workspaceRole, "wiki.ingest") === false;
  const isLintForbidden = hasWorkspacePermission(workspaceRole, "wiki.lint") === false;
  const isIngestDisabled = !isSelecting && (isIngestForbidden || pending !== null || isLintActive);
  // 말풍선 보조줄: 선택 중이면 취소 단축키, 막혀 있으면 짧은 사유
  const ingestHint = isSelecting
    ? <kbd>Esc</kbd>
    : isIngestForbidden
      ? WIKI_INGEST_PERMISSION_HINT
      : isIngestDisabled
        ? (pending === "ingest" ? "진행 중이에요" : "최신화 중에는 할 수 없어요")
        : null;
  const ingestIndicator = getIngestIndicator({
    pendingCount: selectPendingIngestDocuments(documents).length,
    isSelecting,
    isDisabled: isIngestDisabled
  });
  const lintIndicator = getLintIndicator({ isLintEnabled: isLintEnabled && !isLintForbidden, isSelecting });

  return (
    <RailGroup>
      <RailButton
        label={pending === "ingest" ? "위키 편입 중" : (ingestIndicator.label ?? "위키 편입")}
        tooltip={isSelecting ? "선택 취소" : (ingestIndicator.tooltip ?? "위키 편입")}
        tooltipHint={ingestHint}
        isActive={isSelecting}
        hasIndicator={ingestIndicator.isLit}
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
        label={isMaintenanceStatusError && !isLintForbidden ? "위키 최신화 상태 재확인" : (lintIndicator.label ?? "위키 최신화")}
        tooltip={lintIndicator.tooltip ?? "위키 최신화"}
        hasIndicator={lintIndicator.isLit}
        tooltipHint={isSelecting ? "문서 선택 중에는 할 수 없어요" : isLintForbidden ? WIKI_LINT_PERMISSION_HINT : lintHint}
        className={cx(pending === "lint" && styles["is-spinning"])}
        disabled={isSelecting || isLintForbidden || (!isLintEnabled && !isMaintenanceStatusError)}
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
