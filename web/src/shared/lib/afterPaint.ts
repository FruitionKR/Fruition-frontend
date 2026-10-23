/** 로딩 UI가 먼저 그려질 프레임을 확보한 뒤 무거운 동기 초기화를 시작한다. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
