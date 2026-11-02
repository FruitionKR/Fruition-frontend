"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchOperationLogs, type OperationLogItem, type OperationStatus } from "@/entities/operation-log";
import { usePageVisible } from "@/shared/hooks/usePageVisible";
import { getWikiWorkPollInterval, isStaleForIdlePoll } from "./wikiWorkPolling";

const ACTIVE_RESTORE_QUERY_KEY = ["activeRestoreOperations"] as const;

// 롤백(restore)이 끝나지 않은 상태. 백엔드는 status 하나씩만 받으므로 상태별로 조회해 합친다.
// restore는 processing 상태를 거치지 않는다(applying → rebuilding → succeeded/failed).
const ACTIVE_RESTORE_STATUSES: OperationStatus[] = ["applying", "rebuilding", "notify_pending"];

/**
 * 진행 중인 롤백 작업을 ai-operation-logs에서 읽는다.
 * status를 비우면 백엔드가 진행 중 로그를 기본으로 숨기므로 상태를 명시해 조회한다.
 * 진행 중일 때만 3초 폴링한다(useActiveLintOperation과 같은 방식).
 */
async function fetchActiveRestoreOperations() {
  const pages = await Promise.all(
    ACTIVE_RESTORE_STATUSES.map((status) => fetchOperationLogs({ type: "restore", status, size: 10 }))
  );
  return pages.flatMap((page) => page.logs);
}

export function useActiveRestoreOperations(): OperationLogItem[] {
  const isPageVisible = usePageVisible();
  const query = useQuery({
    queryKey: ACTIVE_RESTORE_QUERY_KEY,
    queryFn: fetchActiveRestoreOperations,
    refetchInterval: (activeQuery) => getWikiWorkPollInterval((activeQuery.state.data?.length ?? 0) > 0, isPageVisible),
    // 진행 표시용이라 숨김 탭에서는 멈춘다. 완료 알림은 useOperationNotifications가 따로 폴링한다(#66).
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (activeQuery) => isStaleForIdlePoll(activeQuery.state.dataUpdatedAt)
  });

  return query.data ?? [];
}

/**
 * 진행 중 롤백을 직접 폴링하지 않고, 다른 구독자(위키 작업 버튼 등)가 받아 둔 값만 본다.
 * 롤백 종료를 감지해 그래프를 다시 받는 곳처럼 요청을 늘리면 안 되는 곳에서 쓴다.
 */
export function useObservedActiveRestoreOperations(): OperationLogItem[] {
  const query = useQuery({
    queryKey: ACTIVE_RESTORE_QUERY_KEY,
    queryFn: fetchActiveRestoreOperations,
    enabled: false
  });
  return query.data ?? [];
}

/** 롤백을 막 요청했을 때 진행 중 목록을 바로 다시 받아, 비동기 롤백의 시작과 끝을 구독자가 놓치지 않게 한다. */
export function invalidateActiveRestoreOperations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ACTIVE_RESTORE_QUERY_KEY });
}
