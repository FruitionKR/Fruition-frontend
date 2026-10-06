import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { HIGHLIGHT_NOTICES, getSourceHighlightStatus, resolveHighlightRanges } =
  await import("../src/widgets/source-preview/lib/sourceHighlightState.ts");

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
