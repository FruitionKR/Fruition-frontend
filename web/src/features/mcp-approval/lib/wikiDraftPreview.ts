export const MCP_WIKI_CHANGE_KINDS = [
  "SOURCE_PAGE", "CONCEPT_STATEMENT", "EVIDENCE_INVALIDATION", "PAGE_BODY", "PAGE_DELETE",
  "ENTRY", "LINK", "REFERENCE", "REVIVAL_LINK"
] as const;
export const MCP_WIKI_CHANGE_ACTIONS = ["ADD", "UPDATE", "REMOVE", "DELETE", "REVIVE"] as const;

export type McpWikiChangeKind = (typeof MCP_WIKI_CHANGE_KINDS)[number];
export type McpWikiChangeAction = (typeof MCP_WIKI_CHANGE_ACTIONS)[number];
export type McpWikiEvidence = { document_id: string; block_id: string; quote: string };
export type McpWikiChange = {
  change_id: string;
  kind: McpWikiChangeKind;
  action: McpWikiChangeAction;
  page_id: string;
  subject_id: string | null;
  before_text: string | null;
  after_text: string | null;
  evidence: McpWikiEvidence[];
};
export type McpWikiPreview = {
  schema_version: "mcp.wiki-preview.v1";
  complete: true;
  source_documents: Array<{ document_id: string; source_version: number; source_content_hash: string }>;
  target_pages: Array<{ page_id: string; version: number; content_hash: string }>;
  changes: McpWikiChange[];
};
export type McpWikiQuote = {
  pricing_model: "INGEST_SOURCE_QUANTITY" | "LINT_FIXED_APPLY";
  currency: "KRW";
  price_version: string;
  quantity: number;
  unit: string;
  formula: string;
  maximum_charge_minor: number;
};
export type McpWikiWebDraft = {
  schema_version: "mcp.wiki-web-draft.v1";
  draft_id: string;
  draft_kind: "INGEST" | "LINT";
  draft_version: number;
  draft_hash: string;
  public_state_hash: string;
  client_name: string | null;
  quote: McpWikiQuote;
  preview: McpWikiPreview;
  approval: { status: "AWAITING" | "INVALIDATED" | "REJECTED" | "EXECUTING"; reason: string | null };
  publication: {
    status: "NOT_STARTED" | "APPLYING" | "PUBLISHED" | "NO_CHANGE" | "CONFLICTED" | "HALTED" | "UNKNOWN";
    changed: boolean | null;
    published_reference_hash: string | null;
    committed_at: string | null;
    error_code: string | null;
  };
  settlement: {
    status: "NOT_RESERVED" | "RESERVED" | "PENDING_RECONCILIATION" | "SETTLED" | "RELEASED" | "ADJUSTED";
    charged_minor: number;
  };
};

export type McpWikiApprovalBody = Pick<McpWikiWebDraft, "draft_id" | "draft_version" | "draft_hash" | "public_state_hash">;

export function mcpWikiDraftRoute(workspaceId: string, draftId: string): string {
  return `/mcp/workspaces/${encodeURIComponent(workspaceId)}/wiki-drafts/${encodeURIComponent(draftId)}`;
}

export const mcpWikiDraftQueryKey = (userId: string, workspaceId: string, draftId: string) =>
  ["mcpWikiDraftApproval", userId, workspaceId, draftId] as const;

const CHANGE_KINDS = new Set<string>(MCP_WIKI_CHANGE_KINDS);
const CHANGE_ACTIONS = new Set<string>(MCP_WIKI_CHANGE_ACTIONS);
const APPROVAL_STATUSES = new Set(["AWAITING", "INVALIDATED", "REJECTED", "EXECUTING"]);
const PUBLICATION_STATUSES = new Set(["NOT_STARTED", "APPLYING", "PUBLISHED", "NO_CHANGE", "CONFLICTED", "HALTED", "UNKNOWN"]);
const SETTLEMENT_STATUSES = new Set(["NOT_RESERVED", "RESERVED", "PENDING_RECONCILIATION", "SETTLED", "RELEASED", "ADJUSTED"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseEvidence(value: unknown): McpWikiEvidence | null {
  if (!record(value) || !exactKeys(value, ["document_id", "block_id", "quote"])
    || !nonblank(value.document_id) || !nonblank(value.block_id) || !nonblank(value.quote)) return null;
  return { document_id: value.document_id, block_id: value.block_id, quote: value.quote };
}

function parseChange(value: unknown): McpWikiChange | null {
  if (!record(value)
    || !exactKeys(value, ["change_id", "kind", "action", "page_id", "subject_id", "before_text", "after_text", "evidence"])
    || !nonblank(value.change_id)
    || !CHANGE_KINDS.has(String(value.kind))
    || !CHANGE_ACTIONS.has(String(value.action))
    || !nonblank(value.page_id)
    || !(value.subject_id === null || nonblank(value.subject_id))
    || !nullableText(value.before_text)
    || !nullableText(value.after_text)
    || !Array.isArray(value.evidence)) return null;
  const parsedEvidence = value.evidence.map(parseEvidence);
  if (parsedEvidence.some((item) => item === null)) return null;
  const locators = parsedEvidence.map((item) => `${item!.document_id}\0${item!.block_id}`);
  if (new Set(locators).size !== locators.length) return null;
  if (value.kind === "CONCEPT_STATEMENT" && ["ADD", "UPDATE"].includes(String(value.action)) && parsedEvidence.length === 0) return null;
  return {
    change_id: value.change_id,
    kind: value.kind as McpWikiChangeKind,
    action: value.action as McpWikiChangeAction,
    page_id: value.page_id,
    subject_id: value.subject_id,
    before_text: value.before_text,
    after_text: value.after_text,
    evidence: parsedEvidence as McpWikiEvidence[]
  };
}

function parsePreview(value: unknown): McpWikiPreview | null {
  if (!record(value)
    || !exactKeys(value, ["schema_version", "complete", "source_documents", "target_pages", "changes"])
    || value.schema_version !== "mcp.wiki-preview.v1"
    || value.complete !== true
    || !Array.isArray(value.source_documents)
    || !Array.isArray(value.target_pages)
    || !Array.isArray(value.changes)) return null;
  const sources = value.source_documents.map((source) => {
    if (!record(source) || !exactKeys(source, ["document_id", "source_version", "source_content_hash"]) || !nonblank(source.document_id)
      || !positiveInteger(source.source_version) || !nonblank(source.source_content_hash)) return null;
    return { document_id: source.document_id, source_version: source.source_version, source_content_hash: source.source_content_hash };
  });
  const targets = value.target_pages.map((target) => {
    if (!record(target) || !exactKeys(target, ["page_id", "version", "content_hash"])
      || !nonblank(target.page_id) || !positiveInteger(target.version) || !nonblank(target.content_hash)) return null;
    return { page_id: target.page_id, version: target.version, content_hash: target.content_hash };
  });
  const changes = value.changes.map(parseChange);
  if (sources.some((source) => source === null)
    || targets.some((target) => target === null)
    || changes.some((item) => item === null)
    || new Set(sources.map((source) => source?.document_id)).size !== sources.length
    || new Set(targets.map((target) => target?.page_id)).size !== targets.length
    || new Set(changes.map((item) => item?.change_id)).size !== changes.length) return null;
  const sourceIds = new Set(sources.map((source) => source!.document_id));
  if (changes.some((item) => item!.evidence.some((itemEvidence) => !sourceIds.has(itemEvidence.document_id)))) return null;
  return {
    schema_version: "mcp.wiki-preview.v1",
    complete: true,
    source_documents: sources as McpWikiPreview["source_documents"],
    target_pages: targets as McpWikiPreview["target_pages"],
    changes: changes as McpWikiChange[]
  };
}

/** Document의 owner-partitioned safe projection만 받는다. 불완전/모호한 preview나 임의 가격은 통째로 거절한다. */
export function parseMcpWikiWebDraft(value: unknown): McpWikiWebDraft {
  if (!record(value)
    || !exactKeys(value, ["schema_version", "draft_id", "draft_kind", "draft_version", "draft_hash", "public_state_hash", "client_name", "quote", "preview", "approval", "publication", "settlement"])
    || value.schema_version !== "mcp.wiki-web-draft.v1"
    || !nonblank(value.draft_id)
    || (value.draft_kind !== "INGEST" && value.draft_kind !== "LINT")
    || !positiveInteger(value.draft_version)
    || !nonblank(value.draft_hash)
    || !nonblank(value.public_state_hash)
    || !(value.client_name === null || nonblank(value.client_name))
    || !record(value.quote)
    || !record(value.approval)
    || !record(value.publication)
    || !record(value.settlement)) throw new Error("위키 변경 미리보기 응답 형식이 올바르지 않습니다.");
  const preview = parsePreview(value.preview);
  const quote = value.quote;
  const approval = value.approval;
  const publication = value.publication;
  const settlement = value.settlement;
  if (!preview
    || !exactKeys(quote, ["pricing_model", "currency", "price_version", "quantity", "unit", "formula", "maximum_charge_minor"])
    || !exactKeys(approval, ["status", "reason"])
    || !exactKeys(publication, ["status", "changed", "published_reference_hash", "committed_at", "error_code"])
    || !exactKeys(settlement, ["status", "charged_minor"])
    || (quote.pricing_model !== "INGEST_SOURCE_QUANTITY" && quote.pricing_model !== "LINT_FIXED_APPLY")
    || quote.currency !== "KRW"
    || !nonblank(quote.price_version)
    || !positiveInteger(quote.quantity)
    || !nonblank(quote.unit)
    || !nonblank(quote.formula)
    || !positiveInteger(quote.maximum_charge_minor)
    || !APPROVAL_STATUSES.has(String(approval.status))
    || !nullableText(approval.reason)
    || !PUBLICATION_STATUSES.has(String(publication.status))
    || !(publication.changed === null || typeof publication.changed === "boolean")
    || !nullableText(publication.published_reference_hash)
    || !nullableText(publication.committed_at)
    || !nullableText(publication.error_code)
    || !SETTLEMENT_STATUSES.has(String(settlement.status))
    || !nonnegativeInteger(settlement.charged_minor)) throw new Error("위키 변경 미리보기 응답 형식이 올바르지 않습니다.");
  return { ...value, preview } as McpWikiWebDraft;
}

export function mcpWikiApprovalBody(draft: McpWikiWebDraft): McpWikiApprovalBody {
  return {
    draft_id: draft.draft_id,
    draft_version: draft.draft_version,
    draft_hash: draft.draft_hash,
    public_state_hash: draft.public_state_hash
  };
}

export function canApproveMcpWikiDraft(draft: McpWikiWebDraft): boolean {
  return nonblank(draft.client_name)
    && draft.approval.status === "AWAITING"
    && draft.publication.status === "NOT_STARTED"
    && draft.settlement.status === "NOT_RESERVED";
}

export function shouldPollMcpWikiDraft(draft: McpWikiWebDraft | null | undefined): boolean {
  if (!draft) return false;
  return draft.approval.status === "EXECUTING"
    || ["APPLYING", "UNKNOWN"].includes(draft.publication.status)
    || ["RESERVED", "PENDING_RECONCILIATION"].includes(draft.settlement.status);
}

export function canCancelMcpWikiDraft(draft: McpWikiWebDraft): boolean {
  return draft.approval.status === "EXECUTING" || ["APPLYING", "HALTED", "UNKNOWN"].includes(draft.publication.status);
}

export function mcpWikiDecisionErrorKey(error: unknown): "credit" | "conflict" | "forbidden" | "missing" | "tooLarge" | "unavailable" | "ambiguous" | "failed" {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (status === 402) return "credit";
  if (status === 409) return "conflict";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "missing";
  if (status === 413) return "tooLarge";
  if (status === 503) return "unavailable";
  if (status >= 500 || status === 0) return "ambiguous";
  return "failed";
}

export function mcpWikiChangeGroups(preview: McpWikiPreview): Array<{ kind: McpWikiChangeKind; changes: McpWikiChange[] }> {
  return MCP_WIKI_CHANGE_KINDS.flatMap((kind) => {
    const changes = preview.changes.filter((item) => item.kind === kind);
    return changes.length ? [{ kind, changes }] : [];
  });
}
