import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { formatLintProgressLabel } from "@/features/wiki-ingest/model/activeLintOperation";
import { isLintActionEnabled, selectActiveIngestDocuments } from "@/features/wiki-ingest/model/wikiReflectState";
import { useActiveLintOperation } from "@/features/wiki-ingest/model/useActiveLintOperation";
import { selectGraphDocuments } from "@/features/wiki-ingest/model/graphDocuments";
import { fetchWikiMaintenanceStatus } from "@/features/document-notifications";
import type { DocumentItemResponse } from "@/entities/document";

/**
 * 그래프 뷰 위키 편입·위키 최신화 버튼 상태.
 * 진행 중 편입/최신화 여부와 최신화 가능 여부(maintenance status)를 함께 판단한다.
 */
export function useGraphWikiStatus({
  documents,
  pending
}: {
  documents: DocumentItemResponse[];
  pending: "ingest" | "lint" | null;
}) {
  const t = useTranslations("documents.wiki.hint");
  const tProgress = useTranslations("wiki.lintProgress");
  const activeIngestDocuments = selectActiveIngestDocuments(selectGraphDocuments(documents));
  const activeLintOperation = useActiveLintOperation(pending === "lint");
  const lintProgressLabel = formatLintProgressLabel(activeLintOperation, pending === "lint", Date.now(), tProgress);
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
    // Lint 버튼 상태용이라 숨김 탭에서는 멈춘다. 편입이 끝나면 아래 effect가 다시 받는다(#66).
    refetchIntervalInBackground: false,
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

  const isLintEnabled = isLintActionEnabled({
    needsLint: maintenanceStatus?.needs_lint === true,
    isIngestActive,
    isLintActive
  });
  // 말풍선 보조줄에 붙는 짧은 사유. 바로 실행할 수 있으면 null이라 "위키 최신화"만 보인다.
  const lintHint = isMaintenanceStatusError
    ? t("statusFailed")
    : isLintActive
      ? t("inProgress")
      : isIngestActive
        ? t("blockedByIngest")
        : isMaintenanceStatusFetching
          ? t("checkingStatus")
          : maintenanceStatus?.needs_lint === false
            ? t("upToDate")
            : null;

  return {
    isLintActive,
    isLintEnabled,
    lintHint,
    isMaintenanceStatusError,
    refetchMaintenanceStatus
  };
}
