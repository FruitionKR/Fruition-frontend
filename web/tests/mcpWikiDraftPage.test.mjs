import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/features/mcp-approval/lib/wikiDraftPreview.ts";

const draft = {
  schema_version: "mcp.wiki-web-draft.v1", draft_id: "draft-1", draft_kind: "INGEST", draft_version: 1,
  draft_hash: "draft-hash", public_state_hash: "public-hash", client_name: "<img src=x onerror=bad()>",
  quote: { pricing_model: "INGEST_SOURCE_QUANTITY", currency: "KRW", price_version: "v1", quantity: 2, unit: "pages", formula: "<script>bad()</script>", maximum_charge_minor: 500 },
  preview: { schema_version: "mcp.wiki-preview.v1", complete: true, source_documents: [], target_pages: [], changes: [] },
  approval: { status: "AWAITING", reason: null },
  publication: { status: "NOT_STARTED", changed: null, published_reference_hash: null, committed_at: null, error_code: null },
  settlement: { status: "NOT_RESERVED", charged_minor: 0 }
};
let mutations = 0;
let mutationOptions = [];
let queryError = null;
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/mcp-approval/ui/McpWikiDraftApprovalPage.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const aliases = {
  "react": { ...React, useEffect() {}, useRef: (value) => ({ current: value }) },
  "../api/wikiDraftApproval": { approveMcpWikiDraft: async () => { mutations += 1; }, cancelMcpWikiDraft: async () => { mutations += 1; }, fetchMcpWikiDraft: async () => draft, rejectMcpWikiDraft: async () => { mutations += 1; } },
  "../lib/wikiDraftPreview": contract,
  "./WikiDraftPreview": { WikiDraftPreview: () => React.createElement("div", null, "complete preview") },
  "./McpApprovalPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) },
  "@/entities/user": { useMe: () => ({ data: { id: "user-1" }, isPending: false, error: null }) },
  "@/shared/lib/apiErrors": { LoginRequiredError: class LoginRequiredError extends Error {} },
  "@/shared/lib/authSessionStorage": { setAfterLoginPath() {} },
  "next/link": { __esModule: true, default: ({ href, children }) => React.createElement("a", { href }, children) },
  "next/navigation": { useRouter: () => ({ replace() {} }) },
  "next-intl": { useTranslations: () => (key) => key, useFormatter: () => ({ number: (value) => `KRW ${value}` }) },
  "@tanstack/react-query": {
    useQuery: () => ({ data: draft, error: queryError, isPending: false, isFetching: false, refetch() {} }),
    useQueryClient: () => ({ removeQueries() {}, setQueryData() {}, invalidateQueries() {} }),
    useMutation: (options) => { mutationOptions.push(options); return { isPending: false, error: null, mutate: () => { mutations += 1; } }; }
  }
};
const exports = {};
runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id), window: { addEventListener() {}, removeEventListener() {}, confirm: () => true } });
const Page = exports.default;

test("Wiki draft detail is text-only and never mutates on mount", () => {
  mutations = 0;
  mutationOptions = [];
  const html = renderToStaticMarkup(React.createElement(Page, { workspaceId: "ws-1", draftId: "draft-1" }));
  assert.equal(mutations, 0);
  assert.equal(mutationOptions.length, 3);
  assert.equal(mutationOptions.every((options) => options.retry === false), true, "mutations are never retried automatically");
  assert.match(html, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /complete preview/);
});

test("same-turn approval clicks send only one mutation until it settles", () => {
  mutations = 0;
  mutationOptions = [];
  const tree = Page({ workspaceId: "ws-1", draftId: "draft-1" });
  const nodes = [tree];
  let approveButton;
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== "object") continue;
    if (node.type === "button" && node.props.children === "approve") approveButton = node;
    const children = node.props?.children;
    nodes.push(...(Array.isArray(children) ? children : [children]));
  }
  assert.ok(approveButton);
  approveButton.props.onClick();
  approveButton.props.onClick();
  assert.equal(mutations, 1);
  mutationOptions[0].onSettled();
  approveButton.props.onClick();
  assert.equal(mutations, 2);
});

test("missing trusted client name keeps history visible but disables approval", () => {
  const saved = draft.client_name;
  draft.client_name = null;
  const html = renderToStaticMarkup(React.createElement(Page, { workspaceId: "ws-1", draftId: "draft-1" }));
  draft.client_name = saved;
  assert.match(html, /clientUnavailable/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>approve<\/button>/);
});

test("top-level missing owner or draft hides a previously cached preview and approval", () => {
  queryError = { status: 404 };
  const html = renderToStaticMarkup(React.createElement(Page, { workspaceId: "ws-1", draftId: "draft-1" }));
  queryError = null;
  assert.match(html, /errors\.missing/);
  assert.doesNotMatch(html, /complete preview|>approve<|KRW 500/);
});
