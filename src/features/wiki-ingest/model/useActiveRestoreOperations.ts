"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOperationLogs, type OperationLogItem, type OperationStatus } from "@/entities/operation-log";
import { getWikiWorkPollInterval } from "./wikiWorkPolling";

const ACTIVE_RESTORE_QUERY_KEY = ["activeRestoreOperations"] as const;

// 롤백(restore)이 끝나지 않은 상태. 백엔드는 status 하나씩만 받으므로 상태별로 조회해 합친다.
// restore는 processing 상태를 거치지 않는다(applying → rebuilding → succeeded/failed).
const ACTIVE_RESTORE_STATUSES: OperationStatus[] = ["applying", "rebuilding", "notify_pending"];

/**
 * 진행 중인 롤백 작업을 ai-operation-logs에서 읽는다.
 * status를 비우면 백엔드가 진행 중 로그를 기본으로 숨기므로 상태를 명시해 조회한다.
 * 진행 중일 때만 3초 폴링한다(useActiveLintOperation과 같은 방식).
 */
export function useActiveRestoreOperations(): OperationLogItem[] {
  const query = useQuery({
    queryKey: ACTIVE_RESTORE_QUERY_KEY,
    queryFn: async () => {
      const pages = await Promise.all(
        ACTIVE_RESTORE_STATUSES.map((status) => fetchOperationLogs({ type: "restore", status, size: 10 }))
      );
      return pages.flatMap((page) => page.logs);
    },
    refetchInterval: (activeQuery) => getWikiWorkPollInterval((activeQuery.state.data?.length ?? 0) > 0),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false
  });

  return query.data ?? [];
}
