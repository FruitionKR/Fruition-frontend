/** 이 값보다 작은 차이는 주소창 변화로 보고 가상 키보드로 치지 않는다. */
export const KEYBOARD_MIN_INSET_PX = 120;

/**
 * 레이아웃 뷰포트 아래를 가상 키보드가 가리는 높이(px). 키보드가 없으면 0이다.
 * iOS Safari는 키보드가 떠도 레이아웃 높이가 그대로라 visualViewport와의 차이로 알아낸다.
 * Android(interactive-widget=resizes-content)는 레이아웃이 함께 줄어 0이 된다. 핀치 확대 중에는 판단하지 않는다.
 */
export function computeKeyboardInset({
  layoutHeight,
  visualHeight,
  visualOffsetTop,
  scale
}: {
  layoutHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
  scale: number;
}): number {
  if (Math.abs(scale - 1) > 0.01) return 0;
  const inset = Math.round(layoutHeight - visualHeight - visualOffsetTop);
  return inset >= KEYBOARD_MIN_INSET_PX ? inset : 0;
}
