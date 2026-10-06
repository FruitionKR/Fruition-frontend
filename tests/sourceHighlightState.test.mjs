import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const {
  HIGHLIGHT_NOTICES,
  createMarkdownLoadSequence,
  getSourceBlocksQueryKey,
  getSourceHighlightStatus,
  keepSameDocumentBlocks,
  resolveHighlightRanges,
  selectSourceBlocksForLoad
} = await import("../src/widgets/source-preview/lib/sourceHighlightState.ts");

const MARKDOWN = ["# 정렬", "", "첫 문단", "", "둘째 문단"].join("\n");
const CURRENT = {
  document_id: "doc_1",
  is_stale: false,
  blocks: [
    { block_id: "B0001", line_start: 1, line_end: 1, text: "# 정렬" },
    { block_id: "B0007", line_start: 5, line_end: 5, text: "둘째 문단" }
  ]
};
const settled = { isEnabled: true, isPending: false, isError: false, isPlaceholderData: false, data: CURRENT };

function status(query, ids = ["B0007"]) {
  return getSourceHighlightStatus(query, resolveHighlightRanges(MARKDOWN, query, ids));
}

test("현재 본문용 응답이면 서버 줄 범위를 쓰고 안내가 없다", () => {
  assert.deepEqual(resolveHighlightRanges(MARKDOWN, settled, ["B0007"]).ranges, [
    { blockId: "B0007", startLine: 5, endLine: 5 }
  ]);
  assert.deepEqual(status(settled), { isLoading: false, notice: null });
});

test("이전 본문 버전의 응답(placeholder)은 서버 줄 범위를 믿지 않고 텍스트로 찾는다", () => {
  // 복원 전 본문 기준 범위(3줄)가 is_stale:false로 남아 있어도 복원된 본문에 그대로 적용하면 안 된다.
  const previous = {
    ...CURRENT,
    blocks: [{ block_id: "B0007", line_start: 3, line_end: 3, text: "둘째 문단" }]
  };
  const query = { ...settled, isPlaceholderData: true, data: previous };

  assert.deepEqual(resolveHighlightRanges(MARKDOWN, query, ["B0007"]).ranges, [
    { blockId: "B0007", startLine: 5, endLine: 5 }
  ]);
  // 같은 응답이 현재 본문용이면 서버 범위를 그대로 믿는다.
  assert.deepEqual(resolveHighlightRanges(MARKDOWN, { ...query, isPlaceholderData: false }, ["B0007"]).ranges, [
    { blockId: "B0007", startLine: 3, endLine: 3 }
  ]);
});

test("placeholder로 찾은 결과는 잠정이라 위치를 못 찾아도 안내를 보류한다", () => {
  const query = { ...settled, isPlaceholderData: true };
  assert.deepEqual(status(query, ["B0440"]), { isLoading: false, notice: null });
});

test("응답 없이 조회 중이면 로딩이고, 비활성 쿼리는 로딩으로 보지 않는다", () => {
  const pending = { isEnabled: true, isPending: true, isError: false, isPlaceholderData: false, data: undefined };
  assert.deepEqual(status(pending), { isLoading: true, notice: null });
  assert.equal(resolveHighlightRanges(MARKDOWN, pending, ["B0007"]), null);
  assert.deepEqual(status({ ...pending, isEnabled: false }), { isLoading: false, notice: null });
});

test("응답이 없는 조회 실패만 불러오기 실패로 안내한다", () => {
  const failed = { isEnabled: true, isPending: false, isError: true, isPlaceholderData: false, data: undefined };
  assert.deepEqual(status(failed), { isLoading: false, notice: HIGHLIGHT_NOTICES.loadFailed });
});

test("재조회만 실패해 이전 응답이 남아 있으면 하이라이트를 그리고 실패 안내를 내지 않는다", () => {
  const refetchFailed = { ...settled, isError: true };
  assert.deepEqual(resolveHighlightRanges(MARKDOWN, refetchFailed, ["B0007"]).ranges, [
    { blockId: "B0007", startLine: 5, endLine: 5 }
  ]);
  assert.deepEqual(status(refetchFailed), { isLoading: false, notice: null });
});

test("근거를 하나도 못 찾으면 본문만 표시, 일부만 못 찾으면 일부 안내를 낸다", () => {
  assert.equal(status(settled, ["B0440"]).notice, HIGHLIGHT_NOTICES.noneLocated);
  assert.equal(status(settled, ["B0001", "B0440"]).notice, HIGHLIGHT_NOTICES.someMissing);
});

test("본문이 아직 없으면 범위를 계산하지 않는다", () => {
  assert.equal(resolveHighlightRanges(null, settled, ["B0007"]), null);
  assert.deepEqual(getSourceHighlightStatus(settled, null), { isLoading: false, notice: null });
});

// 복원 전 본문 기준 응답: B0007이 3줄에 있다고 is_stale:false로 답한다.
const BEFORE_RESTORE = {
  ...CURRENT,
  blocks: [{ block_id: "B0007", line_start: 3, line_end: 3, text: "둘째 문단" }]
};

test("본문 로드 ID는 문서를 바꿔도 다시 세지 않아 A→B→A에서 이전 A 로드의 키를 재사용하지 않는다", () => {
  const nextLoad = createMarkdownLoadSequence();
  const cache = new Map();
  const key = (load) => JSON.stringify(getSourceBlocksQueryKey(load.documentId, load));

  const firstA = nextLoad("doc_1");
  cache.set(key(firstA), { ...firstA, response: BEFORE_RESTORE });
  const restoredA = nextLoad("doc_1");
  const otherB = nextLoad("doc_2");
  const reopenedA = nextLoad("doc_1");

  const keys = [firstA, restoredA, otherB, reopenedA].map(key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(cache.has(key(reopenedA)), false);
});

test("이전 로드의 응답(캐시)은 같은 문서여도 서버 줄 범위를 믿지 않는다", () => {
  const nextLoad = createMarkdownLoadSequence();
  const firstA = nextLoad("doc_1");
  nextLoad("doc_2");
  const reopenedA = nextLoad("doc_1");
  const cached = { ...firstA, response: BEFORE_RESTORE };

  const selected = selectSourceBlocksForLoad(reopenedA, cached);
  assert.equal(selected.isPlaceholderData, true);
  // 복원 후 본문에서는 텍스트로 찾아 5줄을 가리킨다(서버의 3줄을 쓰지 않는다).
  assert.deepEqual(resolveHighlightRanges(MARKDOWN, selected, ["B0007"]).ranges, [
    { blockId: "B0007", startLine: 5, endLine: 5 }
  ]);
  assert.equal(getSourceHighlightStatus({ ...settled, ...selected }, null).notice, null);
});

test("현재 로드용 응답만 서버 줄 범위를 믿는다", () => {
  const load = createMarkdownLoadSequence()("doc_1");
  const selected = selectSourceBlocksForLoad(load, { ...load, response: BEFORE_RESTORE });
  assert.deepEqual(selected, { data: BEFORE_RESTORE, isPlaceholderData: false });
  assert.deepEqual(resolveHighlightRanges(MARKDOWN, selected, ["B0007"]).ranges, [
    { blockId: "B0007", startLine: 3, endLine: 3 }
  ]);
});

test("다른 문서의 응답이나 본문 로드 전의 응답은 쓰지 않는다", () => {
  const nextLoad = createMarkdownLoadSequence();
  const a = nextLoad("doc_1");
  const b = nextLoad("doc_2");
  const loadedA = { ...a, response: CURRENT };

  assert.deepEqual(selectSourceBlocksForLoad(b, loadedA), { data: undefined, isPlaceholderData: false });
  assert.deepEqual(selectSourceBlocksForLoad(null, loadedA), { data: undefined, isPlaceholderData: false });
  assert.deepEqual(selectSourceBlocksForLoad(a, undefined), { data: undefined, isPlaceholderData: false });
});

test("placeholder는 같은 문서를 다시 불러올 때만 이어 쓴다", () => {
  const nextLoad = createMarkdownLoadSequence();
  const loadedA = { ...nextLoad("doc_1"), response: CURRENT };
  assert.equal(keepSameDocumentBlocks("doc_1", loadedA), loadedA);
  assert.equal(keepSameDocumentBlocks("doc_2", loadedA), undefined);
  assert.equal(keepSameDocumentBlocks("doc_1", undefined), undefined);
});

test("본문을 아직 불러오지 않았거나 다른 문서의 로드면 조회 키에 로드 ID를 넣지 않는다", () => {
  const load = createMarkdownLoadSequence()("doc_1");
  assert.deepEqual(getSourceBlocksQueryKey("doc_1", load), ["document-blocks", "doc_1", 1]);
  assert.deepEqual(getSourceBlocksQueryKey("doc_2", load), ["document-blocks", "doc_2", null]);
  assert.deepEqual(getSourceBlocksQueryKey("doc_1", null), ["document-blocks", "doc_1", null]);
});
