/**
 * 동시에 limit개까지만 작업을 실행하고 나머지는 받은 순서대로 기다리게 하는 실행기를 만든다.
 * 작업이 실패해도 자리를 비워 다음 작업이 이어 실행된다. 각 호출은 자기 작업의 결과·오류로 풀린다.
 * onStart는 작업이 자리를 얻는 순간 부른다. 자리가 비어 있으면 호출 안에서 바로(동기적으로) 부르므로,
 * 호출하는 쪽은 "대기 중"으로 표시해 두었다가 onStart에서 "진행 중"으로 바꾸면 깜빡임 없이 구분할 수 있다.
 */
export function createConcurrencyLimiter(limit: number): <T>(task: () => Promise<T>, onStart?: () => void) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  function release() {
    active -= 1;
    waiting.shift()?.();
  }

  return <T>(task: () => Promise<T>, onStart?: () => void) => new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1;
      // task가 동기적으로 던져도 자리를 비우도록 Promise 체인 안에서 부른다.
      Promise.resolve().then(task).then(resolve, reject).finally(release);
      onStart?.();
    };
    if (active < limit) start();
    else waiting.push(start);
  });
}
