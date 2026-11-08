// 접수된 요청에서 첫 진행 이벤트를 기다린다. 대기만으로 노드 장애/기동을 단정하지 않는다.
export const AI_PREPARATION_MESSAGE = "AI 서비스 준비 또는 요청 처리를 기다리고 있어요. 처음 실행할 때는 약 2~3분 걸릴 수 있습니다. 준비되면 요청을 자동으로 처리할게요.";
export const AI_PREPARATION_NOTICE_DELAY_MS = 5000;

/** 접수 후에만 시작한다. 첫 진행·완료·실패·취소 때 반환 함수를 호출한다. */
export function startRunPreparationNotice(onWaiting?: (waiting: boolean) => void, signal?: AbortSignal): () => void {
  let stopped = false;
  let shown = false;
  const timer = setTimeout(() => {
    if (stopped || signal?.aborted) return;
    shown = true;
    onWaiting?.(true);
  }, AI_PREPARATION_NOTICE_DELAY_MS);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    if (shown) onWaiting?.(false);
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
