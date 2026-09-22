import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCitationRankMap } from "../src/features/agent-chat/lib/citationRanks.ts";
import * as classNames from "../src/shared/lib/classNames.ts";
import * as segments from "../src/shared/lib/markdownSegments.ts";
import * as closedMath from "../src/shared/lib/remarkClosedMath.ts";
import * as sourceBlocks from "../src/shared/lib/markdownSourceBlocks.ts";

const require = createRequire(import.meta.url);
const output = ts.transpileModule(readFileSync(new URL("../src/shared/ui/MarkdownViewer.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;
const exports = {};
const aliases = {
  "@/shared/lib/remarkClosedMath": closedMath,
  "@/shared/lib/classNames": classNames,
  "@/shared/lib/markdownSegments": segments,
  "@/shared/lib/markdownSourceBlocks": sourceBlocks
};
runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id) });
const { MarkdownViewer } = exports;
const ref = (rank, blocks = ["B0001"], document = "doc1", extra = {}) => ({
  id: rank, rank, reference_type: "evidence", source_document_id: document, source_block_ids: blocks, ...extra
});

test("동일 문서의 블록 집합은 순서와 중복을 무시하고 최소 번호로 통합한다", () => {
  const map = buildCitationRankMap([ref(3, ["B2", "B1", "B1"]), ref(1, ["B1", "B2"]), ref(2, ["B1"]), ref(4, ["B1"], "doc2")]);
  assert.deepEqual([...map], [[1, 1], [2, 2], [3, 1], [4, 4]]);
});

test("출처가 없거나 같은 번호가 다른 근거를 가리키면 통합하지 않는다", () => {
  const map = buildCitationRankMap([ref(1), ref(1, ["B2"]), ref(2), ref(3, []), ref(4, [])]);
  assert.equal(map.has(1), false);
  assert.equal(map.get(2), 2);
  assert.equal(map.has(3), false);
  assert.equal(map.has(4), false);
});

test("대표 블록이 같아도 추가 문서 근거가 다르면 구분한다", () => {
  const map = buildCitationRankMap([ref(1), ref(2, ["B0001"], "doc1", {
    source_refs: [{ source_document_id: "doc2", source_block_id: "B0001" }]
  })]);
  assert.equal(map.get(2), 2);
});

function render(markdown) {
  return renderToStaticMarkup(React.createElement(MarkdownViewer, {
    markdown, citationRankMap: buildCitationRankMap([ref(1), ref(2), ref(3, ["B0002"])]),
    onCitationClick() {}, canClickCitation: (rank) => rank === 1 || rank === 3
  }));
}
const buttons = (html) => [...html.matchAll(/<button[^>]*>\[(\d+)\]<\/button>/g)].map((match) => Number(match[1]));

test("실제 MarkdownViewer에서 연속·묶음 인용을 합치고 떨어진 인용 번호도 연결한다", () => {
  assert.deepEqual(buttons(render("근거[1][2] 다른 근거[3]. 재인용[2]")), [1, 3, 1]);
  assert.deepEqual(buttons(render("근거[1, 2, 3]")), [1, 3]);
  assert.deepEqual(buttons(render("근거[1] [2]")), [1]);
});

test("코드·수식·링크 URL의 숫자는 인용 통합으로 바뀌지 않는다", () => {
  const html = render("`[2]`\n\n```text\n[2]\n```\n\n$$[2]$$\n\n[문서](https://example.com/2)와 $5, $10 [2]");
  assert.deepEqual(buttons(html), [1]);
  assert.match(html, /<code>\[2\]<\/code>/);
  assert.match(html, /class="language-text">\[2\]/);
  assert.match(html, /application\/x-tex">\[2\]/);
  assert.match(html, /href="https:\/\/example.com\/2"/);
  assert.match(html, /\$5, \$10/);
});

test("닫는 구분자가 없는 블록 수식은 원문으로 표시한다", () => {
  for (const markdown of ["$$", "$$ ", "$$\nx+y", "설명\n\n$$\nx+y"]) {
    const html = render(markdown);
    assert.doesNotMatch(html, /class="katex/);
    assert.match(html, /\$\$/);
  }
});

test("양쪽을 감싼 인라인·여러 줄 수식은 렌더링한다", () => {
  for (const markdown of ["$$x+y$$", "$$ x+y $$", "$$\nx+y\n$$", "> $$\n> x+y\n> $$"]) {
    assert.match(render(markdown), /class="katex/);
  }
});
