import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/features/mcp-approval/lib/wikiDraftPreview.ts";
import { buildWorkspaceHref } from "../src/widgets/workspace/lib/workspaceLocation.ts";

const item = (kind, page_title, overrides = {}) => ({
  kind, page_id: `page-${page_title}`, page_title, text: null, before_text: null, related_page_title: null, evidence: [], ...overrides
});
const preview = {
  schema_version: "mcp.wiki-preview.v1", complete: true,
  source_documents: [
    { document_id: "doc-one", source_version: 1, source_content_hash: "sha256-one", display_name: "아키텍처 개요.md" },
    { document_id: "doc-two", source_version: 1, source_content_hash: "sha256-two", display_name: null }
  ],
  target_pages: [{ page_id: "page-target", version: 4, content_hash: "sha256-target" }],
  changes: [{
    change_id: "change-secret", kind: "PAGE_BODY", action: "UPDATE", page_id: "page-target", subject_id: "subject-secret",
    before_text: "# Old wiki body", after_text: "# New wiki body [phish](https://attacker.invalid)", evidence: []
  }],
  summary: [
    item("CONCEPT_CREATE", "Ingest", { page_id: null }),
    item("STATEMENT_ADD", "Ingest", { text: "<img src=x onerror=bad()>", evidence: [{ document_id: "doc-one", block_id: "B0004", quote: "<script>bad()</script>" }] }),
    item("STATEMENT_UPDATE", "Ingest", { before_text: "옛 문장", text: "새 문장", evidence: [{ document_id: "doc-two", block_id: "B0002", quote: "근거 인용" }] }),
    item("STATEMENT_REMOVE", "Lint", { text: null, before_text: "지울 문장" }),
    item("LINK_ADD", "Lint", { related_page_title: "Ingest" }),
    item("CONCEPT_MERGE", "Lint", { related_page_title: "Maintenance" }),
    item("EVIDENCE_INVALIDATION", "Lint", { text: null }),
    item("EVIDENCE_INVALIDATION", "Lint", { text: null })
  ]
};

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/mcp-approval/ui/WikiDraftPreview.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const exports = {};
runInNewContext(output, {
  exports,
  require: (id) => ({
    "next-intl": { useTranslations: () => (key, values) => values ? `${key}(${Object.values(values).join(",")})` : key },
    "@/widgets/workspace/lib/workspaceLocation": { buildWorkspaceHref },
    "../lib/wikiDraftPreview": contract,
    "./McpApprovalPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) }
  }[id] ?? require(id))
});
const render = (props) => renderToStaticMarkup(React.createElement(exports.WikiDraftPreview, props));

test("renders a concept-grouped human summary without wiki bodies, internal IDs, or hashes", () => {
  const html = render({ preview, canOpenSources: true });
  assert.deepEqual([...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]), ["Ingest", "Lint"]);
  for (const kind of ["CONCEPT_CREATE", "STATEMENT_ADD", "STATEMENT_UPDATE", "STATEMENT_REMOVE", "LINK_ADD", "CONCEPT_MERGE"]) {
    assert.match(html, new RegExp(`kinds\\.${kind}`));
  }
  assert.match(html, /<q class="wikiBefore">옛 문장<\/q>.*changedTo.*<q>새 문장<\/q>/);
  assert.match(html, /<q>지울 문장<\/q>/, "a removal without text falls back to the old sentence");
  assert.match(html, /Lint.*linkedWith.*Ingest/);
  assert.match(html, /Lint.*mergedInto.*Maintenance/);
  assert.match(html, /invalidations\(2\)/, "textless invalidations collapse into one counted line");
  for (const hidden of ["wiki body", "change-secret", "subject-secret", "page-target", "page-Ingest", "sha256", "attacker.invalid"]) {
    assert.doesNotMatch(html, new RegExp(hidden), hidden);
  }
  assert.match(html, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test("evidence shows the source name (or a fallback) and links to the highlighted block in the app", () => {
  const html = render({ preview, canOpenSources: true });
  assert.match(html, /<blockquote>근거 인용<\/blockquote>/);
  assert.match(html, /<cite>아키텍처 개요\.md<\/cite>/);
  assert.match(html, /<cite>sourceFallback<\/cite>/);
  assert.match(html, /href="\/home\?doc=doc-one&amp;blocks=B0004"/);
  assert.match(html, /href="\/home\?doc=doc-two&amp;blocks=B0002"/);
  assert.match(html, /target="_blank" rel="noopener"/);
  assert.match(html, /aria-label="openSourceLabel\(아키텍처 개요\.md\)"/);
});

test("evidence links are omitted when the draft belongs to another workspace", () => {
  const html = render({ preview, canOpenSources: false });
  assert.match(html, /<cite>아키텍처 개요\.md<\/cite>/);
  assert.doesNotMatch(html, /<a /);
});

test("a legacy draft without summary shows a neutral note instead of the old diff", () => {
  const html = render({ preview: { ...preview, summary: [] }, canOpenSources: true });
  assert.match(html, /legacy/);
  assert.doesNotMatch(html, /<h3>|wiki body|<blockquote>|intro/);
});
