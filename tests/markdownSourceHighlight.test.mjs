import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as classNames from "../src/shared/lib/classNames.ts";
import * as segments from "../src/shared/lib/markdownSegments.ts";
import * as closedMath from "../src/shared/lib/remarkClosedMath.ts";
import * as sourceBlocks from "../src/shared/lib/markdownSourceBlocks.ts";
import * as customTokens from "../src/shared/lib/remarkCustomTokens.ts";
import * as externalResources from "../src/shared/lib/externalResources.ts";

const require = createRequire(import.meta.url);
const output = ts.transpileModule(readFileSync(new URL("../src/shared/ui/MarkdownViewer.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;
const exports = {};
const aliases = {
  "@/shared/lib/remarkClosedMath": closedMath,
  "@/shared/lib/classNames": classNames,
  "@/shared/lib/markdownSegments": segments,
  "@/shared/lib/markdownSourceBlocks": sourceBlocks,
  "@/shared/lib/remarkCustomTokens": customTokens,
  "@/shared/lib/externalResources": externalResources,
  "@/shared/ui/markdown/ManagedImage": { ManagedImage: (props) => React.createElement("img", props) }
};
runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id) });
const { MarkdownViewer } = exports;

function render(markdown, props = {}) {
  return renderToStaticMarkup(React.createElement(MarkdownViewer, { markdown, ...props }));
}

const highlightedIds = (html) =>
  [...html.matchAll(/class="markdown-source-block is-highlighted[^"]*" data-block-id="([^"]+)"/g)].map((match) => match[1]);

const MARKDOWN = [
  "# 정렬",
  "",
  "삽입정렬 함정 문단",
  "",
  "## 레드블랙트리",
  "",
  "레드블랙트리 문단"
].join("\n");

test("서버 영구 ID는 로컬 순번과 무관하게 줄 범위의 블록을 칠한다", () => {
  // 로컬 순번으로는 B0004가 '레드블랙트리 문단'이지만 서버 ID B0004는 맨 앞 제목이다.
  const html = render(MARKDOWN, {
    highlightedBlocks: [{ block_id: "B0004", rank: 1 }],
    highlightRanges: [{ blockId: "B0004", startLine: 1, endLine: 1 }]
  });

  assert.deepEqual(highlightedIds(html), ["B0004"]);
  assert.match(html, /data-block-id="B0004"[^>]*><h1>정렬<\/h1>/);
  assert.doesNotMatch(html, /is-highlighted[^>]*><p>레드블랙트리 문단/);
});

test("서버 범위가 주어지면 로컬 순번 ID에 접두어를 붙여 서버 ID와 겹치지 않게 한다", () => {
  const html = render(MARKDOWN, {
    highlightedBlocks: [{ block_id: "B0002", rank: 1 }],
    highlightRanges: [{ blockId: "B0002", startLine: 7, endLine: 7 }]
  });

  assert.deepEqual(highlightedIds(html), ["B0002"]);
  assert.match(html, /data-block-id="local-B0002"><p>삽입정렬 함정 문단<\/p>/);
  assert.match(html, /data-block-id="B0002"[^>]*><p>레드블랙트리 문단<\/p>/);
});

test("위치를 찾지 못한 근거는 칠하지 않고 본문은 그대로 보여준다", () => {
  const html = render(MARKDOWN, {
    highlightedBlocks: [{ block_id: "B0440", rank: 1 }],
    highlightRanges: []
  });

  assert.deepEqual(highlightedIds(html), []);
  assert.match(html, /레드블랙트리 문단/);
});

test("리스트 하나가 서버 블록 여러 개를 덮으면 어느 근거든 그 리스트를 칠하고 ID를 모두 남긴다", () => {
  const markdown = ["- 첫 항목", "", "- 둘째 항목"].join("\n");
  const html = render(markdown, {
    highlightedBlocks: [{ block_id: "B0010", rank: 2 }],
    highlightRanges: [
      { blockId: "B0009", startLine: 1, endLine: 1 },
      { blockId: "B0010", startLine: 3, endLine: 3 }
    ]
  });

  assert.match(html, /class="markdown-source-block is-highlighted citation-rank-2" data-block-id="B0009 B0010" data-citation-rank="2"><ul>/);
});

test("하이라이트 범위가 없는 기존 호출자는 로컬 순번 ID를 그대로 쓴다", () => {
  const html = render(MARKDOWN);

  assert.match(html, /data-block-id="B0001"><h1>정렬<\/h1>/);
  assert.doesNotMatch(html, /local-/);
});

test("frontmatter도 서버 범위와 겹치면 서버 ID로 칠한다", () => {
  const markdown = ["---", "title: 정렬", "---", "", "본문"].join("\n");
  const html = render(markdown, {
    highlightedBlocks: [{ block_id: "B0007", rank: 1 }],
    highlightRanges: [{ blockId: "B0007", startLine: 1, endLine: 3 }]
  });

  assert.match(html, /class="markdown-source-block is-highlighted citation-rank-1" data-block-id="B0007"[^>]*><details/);
});
