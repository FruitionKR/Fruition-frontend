/**
 * 작업 탭에서 새로 생긴 진행·확인·선택 필요 카드가 보이도록 목록을 얼마나 굴릴지 정한다.
 * 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

export type VerticalBox = { top: number; bottom: number };

/** 카드 위아래에 남길 여백(px) */
export const REVEAL_MARGIN_PX = 12;

/**
 * 목록(container) 안의 카드(target) 전체가 보이도록 scrollTop에 더할 값. 이미 다 보이면 0.
 * 카드가 목록보다 크면 카드 윗부분(머리글)이 보이게 맞춘다.
 */
export function revealScrollDelta(container: VerticalBox, target: VerticalBox, margin = REVEAL_MARGIN_PX): number {
  const viewTop = container.top + margin;
  const viewBottom = container.bottom - margin;
  if (target.top < viewTop) return target.top - viewTop;
  if (target.bottom > viewBottom) return Math.min(target.bottom - viewBottom, target.top - viewTop);
  return 0;
}

/** 이전에 본 카드 key와 비교해 새로 생긴 key. 순서는 지금 목록 순서를 따른다. */
export function newAttentionKeys(previous: ReadonlySet<string>, current: readonly string[]): string[] {
  return current.filter((key) => !previous.has(key));
}
