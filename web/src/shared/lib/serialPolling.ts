/**
 * intervalMs마다 poll을 부르되, 앞 조회가 끝난 뒤에야 다음 조회를 예약한다(setTimeout 체인).
 * poll이 true를 돌려주면 끝났다고 보고 더 부르지 않는다. 던지면 다음 주기에 다시 부른다.
 * 돌려준 함수를 부르면 예약한 조회를 지우고, 진행 중인 조회가 끝나도 다음을 예약하지 않는다.
 *
 * setInterval(async …)은 응답이 주기보다 느리면 조회가 겹쳐, 끝났다는 응답을 두 번 받아 완료 처리를 두 번 한다.
 */
export function startSerialPolling(poll: () => Promise<boolean>, intervalMs: number): () => void {
  let isStopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    timer = setTimeout(async () => {
      timer = null;
      let isDone = false;
      try {
        isDone = await poll();
      } catch {
        // 일시적인 실패는 다음 주기에 다시 묻는다.
      }
      if (!isDone && !isStopped) schedule();
    }, intervalMs);
  }

  schedule();
  return () => {
    isStopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
