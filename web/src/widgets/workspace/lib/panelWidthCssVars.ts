/**
 * 드래그 중 패널 폭을 React 상태 대신 CSS 변수로 바로 그린다. 레이아웃이 전부 이 변수를 읽으므로
 * pointermove마다 HomeWorkspace 전체(사이드바 트리·채팅·문서 본문)를 다시 렌더하지 않아도 된다.
 * 드래그가 끝나면 훅이 상태를 확정하고 같은 값을 다시 써서 React가 그리는 값과 DOM이 어긋나지 않게 한다.
 */
export function writePanelWidths(element: HTMLElement | null, widths: Record<string, number>) {
  if (!element) return;
  for (const [name, px] of Object.entries(widths)) element.style.setProperty(name, `${px}px`);
}
