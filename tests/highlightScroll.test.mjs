import assert from "node:assert/strict";
import test from "node:test";

const { canShowHighlightedMarkdown, findHighlightedScrollTarget } = await import(
  "../src/widgets/source-preview/lib/highlightScroll.ts"
);

const loaded = { isMarkdownFile: true, isLoading: false, errorMessage: null, rawMarkdown: "# 본문", highlightCount: 1 };

test("본문 로드가 끝나고 하이라이트가 있으면 하이라이트 본문을 그린다", () => {
  assert.equal(canShowHighlightedMarkdown(loaded), true);
});

test("본문이 먼저 들어와도 로딩이 끝나기 전에는 그리지 않는다", () => {
  // setRawMarkdown과 setIsLoading(false)가 다른 렌더로 나뉜 중간 상태
  assert.equal(canShowHighlightedMarkdown({ ...loaded, isLoading: true }), false);
});

test("에러·본문 없음·하이라이트 없음·마크다운 아님이면 그리지 않는다", () => {
  assert.equal(canShowHighlightedMarkdown({ ...loaded, errorMessage: "실패" }), false);
  assert.equal(canShowHighlightedMarkdown({ ...loaded, rawMarkdown: null }), false);
  assert.equal(canShowHighlightedMarkdown({ ...loaded, highlightCount: 0 }), false);
  assert.equal(canShowHighlightedMarkdown({ ...loaded, isMarkdownFile: false }), false);
});

test("빈 본문 문자열도 로드된 본문으로 본다", () => {
  assert.equal(canShowHighlightedMarkdown({ ...loaded, rawMarkdown: "" }), true);
});

test("첫 번째 하이라이트의 연결된 블록을 스크롤 대상으로 고른다", () => {
  const first = { isConnected: true };
  const second = { isConnected: true };
  const target = findHighlightedScrollTarget({ a: first, b: second }, [{ block_id: "a" }, { block_id: "b" }]);
  assert.equal(target, first);
});

test("블록이 없거나 정리(null)됐거나 하이라이트가 없으면 대상이 없다", () => {
  assert.equal(findHighlightedScrollTarget({}, [{ block_id: "a" }]), null);
  assert.equal(findHighlightedScrollTarget({ a: null }, [{ block_id: "a" }]), null);
  assert.equal(findHighlightedScrollTarget({ a: { isConnected: true } }, []), null);
});

test("문서에서 분리된 이전 문서의 블록은 대상으로 삼지 않는다", () => {
  assert.equal(findHighlightedScrollTarget({ a: { isConnected: false } }, [{ block_id: "a" }]), null);
});
