import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lineDiff } from "../src/shared/lib/lineDiff.ts";
import * as contract from "../src/features/mcp-approval/lib/wikiDraftPreview.ts";

const kinds = contract.MCP_WIKI_CHANGE_KINDS;
const preview = {
  schema_version: "mcp.wiki-preview.v1", complete: true,
  source_documents: [
    { document_id: "doc-one", source_version: 1, source_content_hash: "one" },
    { document_id: "doc-two", source_version: 1, source_content_hash: "two" }
  ],
  target_pages: [],
  changes: kinds.map((kind, index) => ({
    change_id: `change-${index}`, kind, action: index === 3 ? "DELETE" : "UPDATE", page_id: `page-${index}`,
    subject_id: `subject-${index}`, before_text: "before", after_text: index === 3 ? null : "[phish](https://attacker.invalid/x) <script>bad()</script>",
    evidence: index < 2 ? [{ document_id: index ? "doc-two" : "doc-one", block_id: "B0001", quote: `<img src=https://attacker.invalid/${index}>` }] : []
  }))
};
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/mcp-approval/ui/WikiDraftPreview.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const exports = {};
runInNewContext(output, {
  exports,
  require: (id) => ({
    "@/shared/lib/lineDiff": { lineDiff },
    "@/shared/ui/markdown/LazyMarkdownViewer": { MarkdownViewer: ({ markdown, linkPolicy }) => React.createElement("pre", { "data-policy": linkPolicy }, markdown) },
    "@/features/agent-chat/ui/DocumentDiffLines": { DocumentDiffLines: ({ label, groups }) => React.createElement("div", { "data-label": label }, groups.flatMap((group) => group.lines).map((line) => line.text).join("|")) },
    "next-intl": { useTranslations: () => (key, values) => values?.version ? `${key} ${values.version}` : key },
    "../lib/wikiDraftPreview": contract,
    "./McpApprovalPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) }
  }[id] ?? require(id))
});

test("renders every cascade item with literal diff, inert Markdown policy, and document-qualified quotes", () => {
  const html = renderToStaticMarkup(React.createElement(exports.WikiDraftPreview, { preview }));
  for (const kind of kinds) assert.match(html, new RegExp(`<h2>kinds\\.${kind}</h2>`));
  assert.equal([...html.matchAll(/<article/g)].length, kinds.length);
  assert.equal([...html.matchAll(/data-policy="inert-external"/g)].length, kinds.length - 1);
  assert.match(html, /doc-one · B0001/);
  assert.match(html, /doc-two · B0001/);
  assert.match(html, /change-0/);
  assert.match(html, /<h2>sources<\/h2>/);
  assert.match(html, />one<\/dd>/);
  assert.match(html, /&lt;img src=https:\/\/attacker\.invalid\/0&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});
