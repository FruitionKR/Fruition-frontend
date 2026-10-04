/**
 * 받은 순서대로 작업을 하나씩 실행하는 큐를 만든다.
 *
 * "진행 중이면 버린다"는 단일 실행 가드는 요청도 안내도 없이 동작을 삼켜,
 * 사용자는 메뉴를 눌렀는데 아무 일도 일어나지 않는 화면을 본다.
 * 직렬 실행은 동시 변경을 막는 목적을 지키면서 어떤 작업도 버리지 않는다.
 */
export function createSerialQueue(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    // 앞 작업의 실패가 뒤 작업을 막지 않도록 큐의 꼬리는 성공으로 수렴시킨다.
    const queued = tail.then(task);
    tail = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  };
}
