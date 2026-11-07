import { useTranslations } from "next-intl";
import type { DocumentItemResponse } from "@/entities/document";
import { useWikiActionPermissions } from "@/features/wiki-ingest/model/useWikiActionPermissions";
import { getWikiActionGate } from "@/features/wiki-ingest/model/wikiActionPermission";
import { cx } from "@/shared/lib/classNames";
import { RailButton, RailGroup } from "@/widgets/rail-navigation/ui/RailNavigation";
import { RailIngestIcon, RailRefreshIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { useGraphWikiStatus } from "../model/useGraphWikiStatus";
import { getIngestIndicator, getLintIndicator, selectPendingIngestDocuments } from "../model/wikiActionIndicators";
import styles from "./DocumentSidebar.module.css";

/**
 * 그래프 뷰 레일의 위키 편입·위키 최신화 버튼 (Figma 1486:4377).
 * 위키 편입은 사이드바 트리를 문서 선택 모드로 바꾸고, 확정은 사이드바 하단 바에서 한다.
 * 편입할 문서가 있거나 최신화가 필요하면 버튼에 주황 점을 켜고 말풍선에 이유를 보여 준다.
 * 위키 편입(wiki.ingest)·위키 최신화(wiki.lint) 권한이 없는 MEMBER에게는 점을 끄고 버튼을 막은 채 말풍선에 사유를 보여 준다.
 * 역할을 확인하는 중에도 403이 날 수 있어 막아 두되, 사유는 띄우지 않는다.
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
  const t = useTranslations("documents.wiki");
  const tWiki = useTranslations("wiki");
  const { isLintActive, isLintEnabled, lintHint, isMaintenanceStatusError, refetchMaintenanceStatus } =
    useGraphWikiStatus({ documents, pending });
  const { canIngest, canLint } = useWikiActionPermissions();
  const ingestGate = getWikiActionGate(canIngest, "ingest", tWiki);
  const lintGate = getWikiActionGate(canLint, "lint", tWiki);
  const isIngestDisabled = !isSelecting && (ingestGate.isBlocked || pending !== null || isLintActive);
  // 말풍선 보조줄: 선택 중이면 취소 단축키, 막혀 있으면 짧은 사유
  const ingestHint = isSelecting
    ? <kbd>Esc</kbd>
    : ingestGate.isBlocked
      ? ingestGate.hint
      : isIngestDisabled
        ? (pending === "ingest" ? t("hint.inProgress") : t("hint.blockedByLint"))
        : null;
  const pendingIngestCount = selectPendingIngestDocuments(documents).length;
  const ingestIndicator = getIngestIndicator({
    pendingCount: pendingIngestCount,
    isSelecting,
    isDisabled: isIngestDisabled
  });
  const lintIndicator = getLintIndicator({ isLintEnabled: isLintEnabled && !lintGate.isBlocked, isSelecting });

  return (
    <RailGroup>
      <RailButton
        label={pending === "ingest" ? t("ingest.running") : ingestIndicator.isLit ? t("ingest.litLabel", { count: pendingIngestCount }) : t("ingest.label")}
        tooltip={isSelecting ? t("cancelSelection") : ingestIndicator.isLit ? t("ingest.litTooltip", { count: pendingIngestCount }) : t("ingest.label")}
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
        label={isMaintenanceStatusError && !lintGate.isBlocked ? t("lint.recheck") : lintIndicator.isLit ? t("lint.litLabel") : t("lint.label")}
        tooltip={lintIndicator.isLit ? t("lint.litTooltip") : t("lint.label")}
        hasIndicator={lintIndicator.isLit}
        tooltipHint={isSelecting ? t("hint.blockedBySelection") : lintGate.isBlocked ? lintGate.hint : lintHint}
        className={cx(pending === "lint" && styles["is-spinning"])}
        disabled={isSelecting || lintGate.isBlocked || (!isLintEnabled && !isMaintenanceStatusError)}
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
