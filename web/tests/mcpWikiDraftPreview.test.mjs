import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const {
  canApproveMcpWikiDraft, canCancelMcpWikiDraft, mcpWikiApprovalBody, mcpWikiChangeGroups,
  mcpWikiDecisionErrorKey, mcpWikiDraftQueryKey, mcpWikiDraftRoute, parseMcpWikiWebDraft, shouldPollMcpWikiDraft
} = await import("../src/features/mcp-approval/lib/wikiDraftPreview.ts");

const source = (document_id) => ({ document_id, source_version: 3, source_content_hash: `source-${document_id}` });
const change = (change_id, kind, action, document_id, overrides = {}) => ({
  change_id, kind, action, page_id: `page-${change_id}`, subject_id: `subject-${change_id}`,
  before_text: "before", after_text: "after",
  evidence: document_id ? [{ document_id, block_id: "B0001", quote: `quote-${document_id}` }] : [],
  ...overrides
});
const preview = {
  schema_version: "mcp.wiki-preview.v1", complete: true, source_documents: [source("doc-one"), source("doc-two")],
  target_pages: [{ page_id: "page-existing", version: 7, content_hash: "opaque-page-hash" }],
  changes: [
    change("source", "SOURCE_PAGE", "UPDATE", "doc-one"),
    change("statement", "CONCEPT_STATEMENT", "ADD", "doc-two"),
    change("invalid", "EVIDENCE_INVALIDATION", "REMOVE", "doc-one"),
    change("delete", "PAGE_DELETE", "DELETE", null, { after_text: null }),
    change("entry", "ENTRY", "UPDATE", null),
    change("link", "LINK", "ADD", null),
    change("reference", "REFERENCE", "REMOVE", null),
    change("revival", "REVIVAL_LINK", "REVIVE", null)
  ]
};
const draft = {
  schema_version: "mcp.wiki-web-draft.v1", draft_id: "draft-1", draft_kind: "INGEST", draft_version: 1,
  draft_hash: "opaque-draft-hash", public_state_hash: "opaque-public-hash", client_name: "Registered client",
  quote: { pricing_model: "INGEST_SOURCE_QUANTITY", currency: "KRW", price_version: "wiki-v1", quantity: 2, unit: "source-window", formula: "2 source windows", maximum_charge_minor: 500 },
  preview,
  approval: { status: "AWAITING", reason: null },
  publication: { status: "NOT_STARTED", changed: null, published_reference_hash: null, committed_at: null, error_code: null },
  settlement: { status: "NOT_RESERVED", charged_minor: 0 }
};

test("parses the complete INGEST cascade and keeps equal block IDs document-qualified", () => {
  const parsed = parseMcpWikiWebDraft(draft);
  assert.equal(parsed.preview.changes.length, 8);
  assert.deepEqual(parsed.preview.changes.slice(0, 2).map((item) => item.evidence[0]), [
    { document_id: "doc-one", block_id: "B0001", quote: "quote-doc-one" },
    { document_id: "doc-two", block_id: "B0001", quote: "quote-doc-two" }
  ]);
  assert.deepEqual(mcpWikiChangeGroups(parsed.preview).map((group) => group.kind), [
    "SOURCE_PAGE", "CONCEPT_STATEMENT", "EVIDENCE_INVALIDATION", "PAGE_DELETE", "ENTRY", "LINK", "REFERENCE", "REVIVAL_LINK"
  ]);
});

test("parses a complete LINT preview without requiring evidence on structural changes", () => {
  const parsed = parseMcpWikiWebDraft({
    ...draft, draft_kind: "LINT", quote: { ...draft.quote, pricing_model: "LINT_FIXED_APPLY" },
    preview: { ...preview, changes: [change("link", "LINK", "REMOVE", null)] }
  });
  assert.equal(parsed.draft_kind, "LINT");
  assert.deepEqual(parsed.preview.changes[0].evidence, []);
});

test("parses a LINT statement edit, which the pipeline reports as a PAGE_BODY update", () => {
  const parsed = parseMcpWikiWebDraft({
    ...draft, draft_kind: "LINT", quote: { ...draft.quote, pricing_model: "LINT_FIXED_APPLY" },
    preview: { ...preview, changes: [change("body", "PAGE_BODY", "UPDATE", null)] }
  });
  assert.notEqual(parsed, null);
  assert.deepEqual(mcpWikiChangeGroups(parsed.preview).map((group) => group.kind), ["PAGE_BODY"]);
});

test("fails closed for incomplete, malformed, internal, duplicate, or unmapped preview data", () => {
  const invalid = [
    { ...draft, preview: { ...preview, complete: false } },
    { ...draft, preview: { ...preview, changes: [{ ...preview.changes[1], evidence: [] }] } },
    { ...draft, preview: { ...preview, source_documents: [{ ...source("doc-one"), snapshot_id: "internal" }] } },
    { ...draft, preview: { ...preview, source_documents: [source("doc-one"), source("doc-one")] } },
    { ...draft, preview: { ...preview, target_pages: [preview.target_pages[0], preview.target_pages[0]] } },
    { ...draft, preview: { ...preview, changes: [preview.changes[0], { ...preview.changes[0] }] } },
    { ...draft, preview: { ...preview, changes: [change("statement", "CONCEPT_STATEMENT", "ADD", "doc-missing")] } },
    { ...draft, preview: { ...preview, changes: [{ ...preview.changes[0], evidence: [preview.changes[0].evidence[0], preview.changes[0].evidence[0]] }] } },
    { ...draft, quote: { ...draft.quote, maximum_charge_minor: 0 } },
    { ...draft, browser_price: 1 }
  ];
  for (const value of invalid) assert.throws(() => parseMcpWikiWebDraft(value));
});

test("treats server hashes as opaque and submits only the four immutable approval fields", () => {
  const parsed = parseMcpWikiWebDraft(draft);
  assert.deepEqual(mcpWikiApprovalBody(parsed), {
    draft_id: "draft-1", draft_version: 1, draft_hash: "opaque-draft-hash", public_state_hash: "opaque-public-hash"
  });
  assert.equal(canApproveMcpWikiDraft(parsed), true);
  const lawfulHistory = parseMcpWikiWebDraft({ ...draft, client_name: null, approval: { status: "INVALIDATED", reason: "USER_DISCONNECT" } });
  assert.equal(canApproveMcpWikiDraft(lawfulHistory), false, "missing trusted client information disables approval without hiding history");
});

test("polling keeps publication and settlement separate, including UNKNOWN and pending settlement", () => {
  const parsed = parseMcpWikiWebDraft(draft);
  assert.equal(shouldPollMcpWikiDraft({ ...parsed, approval: { status: "EXECUTING", reason: null } }), true);
  assert.equal(shouldPollMcpWikiDraft({ ...parsed, publication: { ...parsed.publication, status: "UNKNOWN", error_code: "NOT_FOUND" } }), true);
  assert.equal(shouldPollMcpWikiDraft({
    ...parsed,
    publication: { ...parsed.publication, status: "PUBLISHED", changed: true },
    settlement: { status: "PENDING_RECONCILIATION", charged_minor: 0 }
  }), true);
  assert.equal(shouldPollMcpWikiDraft({
    ...parsed,
    publication: { ...parsed.publication, status: "NO_CHANGE", changed: false },
    settlement: { status: "RELEASED", charged_minor: 0 }
  }), false);
  assert.equal(canCancelMcpWikiDraft({ ...parsed, publication: { ...parsed.publication, status: "HALTED" } }), true);
  assert.equal(canCancelMcpWikiDraft(parsed), false);
});

test("route/cache scope and decision errors keep owners and failure classes distinct", () => {
  assert.equal(mcpWikiDraftRoute("ws/one", "draft one"), "/mcp/workspaces/ws%2Fone/wiki-drafts/draft%20one");
  assert.deepEqual(mcpWikiDraftQueryKey("user-1", "ws-1", "draft-1"), ["mcpWikiDraftApproval", "user-1", "ws-1", "draft-1"]);
  assert.notDeepEqual(mcpWikiDraftQueryKey("user-1", "ws-1", "draft-1"), mcpWikiDraftQueryKey("user-2", "ws-1", "draft-1"));
  assert.notDeepEqual(mcpWikiDraftQueryKey("user-1", "ws-1", "draft-1"), mcpWikiDraftQueryKey("user-1", "ws-2", "draft-1"));
  assert.equal(mcpWikiDecisionErrorKey({ status: 402 }), "credit");
  assert.equal(mcpWikiDecisionErrorKey({ status: 409 }), "conflict");
  assert.equal(mcpWikiDecisionErrorKey({ status: 404 }), "missing");
  assert.equal(mcpWikiDecisionErrorKey({ status: 413 }), "tooLarge");
  assert.equal(mcpWikiDecisionErrorKey({ status: 503 }), "unavailable");
  assert.equal(mcpWikiDecisionErrorKey(new TypeError("lost response")), "ambiguous");
});
