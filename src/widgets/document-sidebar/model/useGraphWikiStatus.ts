import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const activeIngestDocuments = selectActiveIngestDocuments(selectGraphDocuments(documents));
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

  const isLintEnabled = isLintActionEnabled({
    needsLint: maintenanceStatus?.needs_lint === true,
    isIngestActive,
    isLintActive
  });
  // 말풍선 보조줄에 붙는 짧은 사유. 바로 실행할 수 있으면 null이라 "위키 최신화"만 보인다.
  const lintHint = isMaintenanceStatusError
    ? "상태를 못 불러왔어요 · 눌러서 재확인"
    : isLintActive
      ? "진행 중이에요"
      : isIngestActive
        ? "편입 중에는 할 수 없어요"
        : isMaintenanceStatusFetching
          ? "상태 확인 중…"
          : maintenanceStatus?.needs_lint === false
            ? "최신 상태예요"
            : null;

  return {
    isLintActive,
    isLintEnabled,
    lintHint,
    isMaintenanceStatusError,
    refetchMaintenanceStatus
  };
}
