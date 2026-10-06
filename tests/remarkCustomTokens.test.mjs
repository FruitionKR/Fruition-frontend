import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { rankColorClass, remarkCustomTokens } from "../src/shared/lib/remarkCustomTokens.ts";

const parse = (markdown, options) => unified().use(remarkParse).use(remarkCustomTokens, options).run(unified().use(remarkParse).parse(markdown));

test("remarkCustomTokens는 wikilink와 citation을 커스텀 노드로 분리한다", async () => {
  const tree = await parse("앞 [[페이지|별칭]] 중간 [1, 2] 뒤", { citableRanks: new Set([1, 2]) });
  const children = tree.children[0].children;
  assert.deepEqual(children.map((node) => node.type), ["text", "wikiLinkToken", "text", "citationToken", "citationToken", "text"]);
  assert.equal(children[1].children[0].value, "별칭");
  assert.equal(children[1].data.hName, "span");
  assert.deepEqual(children.filter((node) => node.type === "citationToken").map((node) => node.data.hProperties.rank), [1, 2]);
});

test("remarkCustomTokens는 citationRankMap으로 순위를 치환하고 중복을 제거한다", async () => {
  const tree = await parse("[3][3]", { citationRankMap: new Map([[3, 1]]), citableRanks: new Set([3]) });
  const tokens = tree.children[0].children.filter((node) => node.type === "citationToken");
  assert.deepEqual(tokens.map((node) => node.children[0].value), ["[1]"]);
});

const texts = (tree) => tree.children[0].children.map((node) => node.type === "text" ? node.value : `<${node.type}:${node.data?.hProperties?.rank ?? node.children[0].value}>`);

test("remarkCustomTokens는 references rank가 아닌 숫자 배열을 중복 제거 없이 원문으로 둔다", async () => {
  const citable = new Set([1, 2]);
  assert.deepEqual(texts(await parse("insertion_sort([5, 2, 4, 6, 1, 3])", { citableRanks: citable })), ["insertion_sort([5, 2, 4, 6, 1, 3])"]);
  assert.deepEqual(texts(await parse("배열 [1, 1, 3]", { citableRanks: new Set([1]) })), ["배열 [1, 1, 3]"]);
  assert.deepEqual(texts(await parse("[1, 9] 와 [1][9]", { citableRanks: citable })), ["[1, 9] 와 [1][9]"]);
});

test("remarkCustomTokens는 citableRanks가 없거나 비어 있으면 숫자 괄호를 바꾸지 않는다", async () => {
  assert.deepEqual(texts(await parse("근거 [1, 2]")), ["근거 [1, 2]"]);
  assert.deepEqual(texts(await parse("근거 [1, 2]", { citableRanks: new Set() })), ["근거 [1, 2]"]);
});

test("remarkCustomTokens는 거부한 배열 뒤의 citation과 wikilink를 그대로 분리한다", async () => {
  const options = { citableRanks: new Set([1]) };
  assert.deepEqual(texts(await parse("[5, 2] 그리고 [1]", options)), ["[5, 2] 그리고 ", "<citationToken:1>"]);
  assert.deepEqual(texts(await parse("[5, 2] [[문서]] 끝 [1]", options)), ["[5, 2] ", "<wikiLinkToken:문서>", " 끝 ", "<citationToken:1>"]);
});

test("remarkCustomTokens는 원래 rank로 판정한 뒤 citationRankMap으로 치환한다", async () => {
  const tree = await parse("[3]", { citableRanks: new Set([3]), citationRankMap: new Map([[3, 1]]) });
  assert.deepEqual(texts(tree), ["<citationToken:1>"]);
});

test("rankColorClass는 5개 팔레트를 순환한다", () => {
  assert.equal(rankColorClass(1), "citation-rank-1");
  assert.equal(rankColorClass(6), "citation-rank-1");
  assert.equal(rankColorClass(5), "citation-rank-5");
});
