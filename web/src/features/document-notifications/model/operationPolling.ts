const POLL_INTERVAL_MS = 15_000;
// 진행 중인 작업을 알고 있으면 종결을 빨리 잡도록 짧게 폴링한다.
const ACTIVE_POLL_INTERVAL_MS = 3_000;
// 숨김 탭은 완료 브라우저 알림만 띄우면 되므로 느리게 폴링한다(#66). 복귀하면 즉시 한 번 폴링한다.
const HIDDEN_ACTIVE_POLL_INTERVAL_MS = 30_000;

/**
 * 작업 알림의 다음 폴링 지연. 진행 중 작업이 있으면 숨김 탭에서도 느리게 폴링해 완료 브라우저 알림을 띄우고,
 * 없으면 숨김 탭은 null(복귀할 때까지 멈춤)이다.
 */
export function nextOperationPollDelay(hasActive: boolean, isHidden: boolean): number | null {
  if (hasActive) return isHidden ? HIDDEN_ACTIVE_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
  return isHidden ? null : POLL_INTERVAL_MS;
}
