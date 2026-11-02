/**
 * 동시에 limit개까지만 작업을 실행하고 나머지는 받은 순서대로 기다리게 하는 실행기를 만든다.
 * 작업이 실패해도 자리를 비워 다음 작업이 이어 실행된다. 각 호출은 자기 작업의 결과·오류로 풀린다.
 */
export function createConcurrencyLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  function release() {
    active -= 1;
    waiting.shift()?.();
  }

  return <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1;
      // task가 동기적으로 던져도 자리를 비우도록 Promise 체인 안에서 부른다.
      Promise.resolve().then(task).then(resolve, reject).finally(release);
    };
    if (active < limit) start();
    else waiting.push(start);
  });
}
