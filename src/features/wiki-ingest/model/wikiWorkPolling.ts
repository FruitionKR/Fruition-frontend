export const ACTIVE_WIKI_WORK_POLL_INTERVAL_MS = 3_000;
export const IDLE_WIKI_WORK_POLL_INTERVAL_MS = 15_000;

/**
 * 진행 중인 작업이 있으면 숨김 탭에서도 짧게 폴링한다(완료 브라우저 알림용).
 * 진행 중인 작업이 없으면 보이는 탭에서만 폴링한다.
 */
export function getWikiWorkPollInterval(hasActiveWork: boolean, isPageVisible = true): number | false {
  if (hasActiveWork) return ACTIVE_WIKI_WORK_POLL_INTERVAL_MS;
  return isPageVisible ? IDLE_WIKI_WORK_POLL_INTERVAL_MS : false;
}

/** 탭 복귀 시 평소 폴링 주기보다 오래된 데이터만 즉시 다시 받는다. */
export function isStaleForIdlePoll(dataUpdatedAt: number, now = Date.now()): boolean {
  return now - dataUpdatedAt >= IDLE_WIKI_WORK_POLL_INTERVAL_MS;
}
