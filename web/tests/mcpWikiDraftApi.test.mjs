import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as contract from "../src/features/mcp-approval/lib/wikiDraftPreview.ts";

const draft = {
  schema_version: "mcp.wiki-web-draft.v1", draft_id: "draft-1", draft_kind: "LINT", draft_version: 3,
  draft_hash: "draft-hash", public_state_hash: "public-hash", client_name: "Client",
  quote: { pricing_model: "LINT_FIXED_APPLY", currency: "KRW", price_version: "v1", quantity: 1, unit: "apply", formula: "one apply", maximum_charge_minor: 200 },
  preview: { schema_version: "mcp.wiki-preview.v1", complete: true, source_documents: [], target_pages: [], changes: [] },
  approval: { status: "AWAITING", reason: null },
  publication: { status: "NOT_STARTED", changed: null, published_reference_hash: null, committed_at: null, error_code: null },
  settlement: { status: "NOT_RESERVED", charged_minor: 0 }
};
const calls = [];
const client = {
  apiFetch: async (path, init = {}) => {
    calls.push({ path, init });
    return { body: draft };
  },
  idempotentJsonHeaders: () => ({ "Content-Type": "application/json", "Idempotency-Key": "browser-key" }),
  parseJsonOrThrow: async (response) => response.body,
  workspacePath: (workspaceId, ...segments) => `/api/workspaces/${encodeURIComponent(workspaceId)}/${segments.map(encodeURIComponent).join("/")}`
};
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/mcp-approval/api/wikiDraftApproval.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const exports = {};
runInNewContext(output, { exports, require: (id) => ({ "@/shared/api/client": client, "../lib/wikiDraftPreview": contract }[id] ?? require(id)) });

test("GET reads the owner-partitioned web draft without a mutation", async () => {
  calls.length = 0;
  await exports.fetchMcpWikiDraft("ws/one", "draft-1", new AbortController().signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workspaces/ws%2Fone/mcp/wiki-drafts/draft-1");
  assert.equal(calls[0].init.method, undefined);
});

test("explicit approve sends only the four immutable draft fields", async () => {
  calls.length = 0;
  await exports.approveMcpWikiDraft("ws-1", draft);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workspaces/ws-1/mcp/wiki-drafts/draft-1/approve");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    draft_id: "draft-1", draft_version: 3, draft_hash: "draft-hash", public_state_hash: "public-hash"
  });
});

test("whole-draft reject and cancel send exact empty JSON objects", async () => {
  calls.length = 0;
  await exports.rejectMcpWikiDraft("ws-1", "draft-1");
  await exports.cancelMcpWikiDraft("ws-1", "draft-1");
  assert.deepEqual(calls.map(({ path, init }) => [path, init.method, init.body]), [
    ["/api/workspaces/ws-1/mcp/wiki-drafts/draft-1/reject", "POST", "{}"],
    ["/api/workspaces/ws-1/mcp/wiki-drafts/draft-1/cancel", "POST", "{}"]
  ]);
});
