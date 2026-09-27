import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { rankColorClass, remarkCustomTokens } from "../src/shared/lib/remarkCustomTokens.ts";

const parse = (markdown, options) => unified().use(remarkParse).use(remarkCustomTokens, options).run(unified().use(remarkParse).parse(markdown));

test("remarkCustomTokens는 wikilink와 citation을 커스텀 노드로 분리한다", async () => {
  const tree = await parse("앞 [[페이지|별칭]] 중간 [1, 2] 뒤");
  const children = tree.children[0].children;
  assert.deepEqual(children.map((node) => node.type), ["text", "wikiLinkToken", "text", "citationToken", "citationToken", "text"]);
  assert.equal(children[1].children[0].value, "별칭");
  assert.equal(children[1].data.hName, "span");
  assert.deepEqual(children.filter((node) => node.type === "citationToken").map((node) => node.data.hProperties.rank), [1, 2]);
});

test("remarkCustomTokens는 citationRankMap으로 순위를 치환하고 중복을 제거한다", async () => {
  const tree = await parse("[3][3]", { citationRankMap: new Map([[3, 1]]) });
  const tokens = tree.children[0].children.filter((node) => node.type === "citationToken");
  assert.deepEqual(tokens.map((node) => node.children[0].value), ["[1]"]);
});

test("rankColorClass는 5개 팔레트를 순환한다", () => {
  assert.equal(rankColorClass(1), "citation-rank-1");
  assert.equal(rankColorClass(6), "citation-rank-1");
  assert.equal(rankColorClass(5), "citation-rank-5");
});
