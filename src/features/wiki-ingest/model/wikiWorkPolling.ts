export const ACTIVE_WIKI_WORK_POLL_INTERVAL_MS = 3_000;
export const IDLE_WIKI_WORK_POLL_INTERVAL_MS = 15_000;
/** 숨김 탭에서 완료 브라우저 알림만을 위해 남기는 느린 주기(#66). */
export const HIDDEN_ACTIVE_WIKI_WORK_POLL_INTERVAL_MS = 30_000;

/**
 * 진행 중인 작업이 있으면 보이는 탭은 짧게, 숨김 탭은 완료 브라우저 알림용으로 느리게 폴링한다.
 * 진행 중인 작업이 없으면 보이는 탭에서만 폴링한다.
 * 숨김 탭 폴링이 알림에 필요 없는 쿼리는 refetchIntervalInBackground: false로 숨김 동안 멈춘다.
 */
export function getWikiWorkPollInterval(hasActiveWork: boolean, isPageVisible = true): number | false {
  if (hasActiveWork) return isPageVisible ? ACTIVE_WIKI_WORK_POLL_INTERVAL_MS : HIDDEN_ACTIVE_WIKI_WORK_POLL_INTERVAL_MS;
  return isPageVisible ? IDLE_WIKI_WORK_POLL_INTERVAL_MS : false;
}

/** 탭 복귀 시 평소 폴링 주기보다 오래된 데이터만 즉시 다시 받는다. */
export function isStaleForIdlePoll(dataUpdatedAt: number, now = Date.now()): boolean {
  return now - dataUpdatedAt >= IDLE_WIKI_WORK_POLL_INTERVAL_MS;
}
