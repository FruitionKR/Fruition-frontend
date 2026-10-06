export type HighlightedMarkdownState = {
  isMarkdownFile: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  rawMarkdown: string | null;
  highlightCount: number;
};

/**
 * 근거 하이라이트가 있는 마크다운 본문(MarkdownViewer)을 그릴 수 있는지 판단한다.
 * 본문(rawMarkdown)과 로딩 종료(isLoading)는 따로 갱신될 수 있으므로,
 * 스크롤 effect도 렌더와 같은 조건을 보고 블록이 실제로 그려진 뒤에 실행되게 한다.
 */
export function canShowHighlightedMarkdown(state: HighlightedMarkdownState): boolean {
  return (
    state.isMarkdownFile &&
    !state.isLoading &&
    !state.errorMessage &&
    state.rawMarkdown !== null &&
    state.highlightCount > 0
  );
}

/**
 * 첫 번째 하이라이트 블록 노드를 찾는다.
 * 문서에서 분리된 노드는 위치가 모두 0으로 측정되어 엉뚱한 곳으로 스크롤되므로 제외한다.
 */
export function findHighlightedScrollTarget<T extends { isConnected: boolean }>(
  blockRefs: Record<string, T | null>,
  highlights: readonly { block_id: string }[]
): T | null {
  const firstBlockId = highlights[0]?.block_id;
  if (!firstBlockId) return null;
  const block = blockRefs[firstBlockId];
  return block?.isConnected ? block : null;
}
