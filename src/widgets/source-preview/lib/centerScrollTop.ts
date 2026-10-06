export type ScrollBox = { top: number; scrollTop: number; scrollHeight: number; clientHeight: number };
export type BlockBox = { top: number; height: number };

/**
 * 블록을 스크롤 컨테이너 가운데에 두는 scrollTop을 계산한다.
 * scrollIntoView는 조상 요소와 페이지까지 스크롤하므로, 컨테이너만 직접 스크롤할 때 쓴다.
 * top은 둘 다 viewport 기준 좌표이고, 결과는 [0, 최대 스크롤]로 제한한다.
 */
export function getCenteredScrollTop(container: ScrollBox, block: BlockBox): number {
  const target = container.scrollTop + (block.top - container.top) - (container.clientHeight - block.height) / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(Math.max(0, target), maxScrollTop);
}
