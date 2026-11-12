export const MCP_WIKI_CHANGE_KINDS = [
  "SOURCE_PAGE", "CONCEPT_STATEMENT", "EVIDENCE_INVALIDATION", "PAGE_BODY", "PAGE_DELETE",
  "ENTRY", "LINK", "REFERENCE", "REVIVAL_LINK"
] as const;
export const MCP_WIKI_CHANGE_ACTIONS = ["ADD", "UPDATE", "REMOVE", "DELETE", "REVIVE"] as const;
export const MCP_WIKI_SUMMARY_KINDS = [
  "CONCEPT_CREATE", "SOURCE_PAGE", "STATEMENT_ADD", "STATEMENT_UPDATE", "STATEMENT_REMOVE",
  "EVIDENCE_INVALIDATION", "LINK_ADD", "LINK_REMOVE", "CONCEPT_MERGE", "CONCEPT_DELETE"
] as const;

export type McpWikiChangeKind = (typeof MCP_WIKI_CHANGE_KINDS)[number];
export type McpWikiChangeAction = (typeof MCP_WIKI_CHANGE_ACTIONS)[number];
export type McpWikiSummaryKind = (typeof MCP_WIKI_SUMMARY_KINDS)[number];
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
/** 사람이 읽는 변경 요약 한 줄. 위키 본문(Markdown)은 담지 않고 개념 제목·문장·근거만 담는다. */
export type McpWikiSummaryItem = {
  kind: McpWikiSummaryKind;
  page_id: string | null;
  page_title: string;
  text: string | null;
  before_text: string | null;
  related_page_title: string | null;
  evidence: McpWikiEvidence[];
};
export type McpWikiSourceDocument = {
  document_id: string;
  source_version: number;
  source_content_hash: string;
  display_name: string | null;
};
export type McpWikiPreview = {
  schema_version: "mcp.wiki-preview.v1";
  complete: true;
  source_documents: McpWikiSourceDocument[];
  target_pages: Array<{ page_id: string; version: number; content_hash: string }>;
  changes: McpWikiChange[];
  /** 배포 전에 만든 초안에는 없다. 없으면 빈 목록이다. */
  summary: McpWikiSummaryItem[];
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
const SUMMARY_KINDS = new Set<string>(MCP_WIKI_SUMMARY_KINDS);
const APPROVAL_STATUSES = new Set(["AWAITING", "INVALIDATED", "REJECTED", "EXECUTING"]);
const PUBLICATION_STATUSES = new Set(["NOT_STARTED", "APPLYING", "PUBLISHED", "NO_CHANGE", "CONFLICTED", "HALTED", "UNKNOWN"]);
const SETTLEMENT_STATUSES = new Set(["NOT_RESERVED", "RESERVED", "PENDING_RECONCILIATION", "SETTLED", "RELEASED", "ADJUSTED"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
/** 필수 키는 모두 있고, 선택 키는 있어도 되며, 그 밖의 키는 없다. 배포 전 초안(선택 키 없음)을 받기 위해 쓴다. */
function keysWithOptional(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  return required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
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

function parseSummaryItem(value: unknown): McpWikiSummaryItem | null {
  if (!record(value)
    || !exactKeys(value, ["kind", "page_id", "page_title", "text", "before_text", "related_page_title", "evidence"])
    || !SUMMARY_KINDS.has(String(value.kind))
    || !(value.page_id === null || nonblank(value.page_id))
    || typeof value.page_title !== "string"
    || !nullableText(value.text)
    || !nullableText(value.before_text)
    || !nullableText(value.related_page_title)
    || !Array.isArray(value.evidence)) return null;
  const evidence = value.evidence.map(parseEvidence);
  if (evidence.some((item) => item === null)) return null;
  return {
    kind: value.kind as McpWikiSummaryKind,
    page_id: value.page_id,
    page_title: value.page_title,
    text: value.text,
    before_text: value.before_text,
    related_page_title: value.related_page_title,
    evidence: evidence as McpWikiEvidence[]
  };
}

function parseSourceDocument(source: unknown): McpWikiSourceDocument | null {
  if (!record(source)
    || !keysWithOptional(source, ["document_id", "source_version", "source_content_hash"], ["display_name"])
    || !nonblank(source.document_id)
    || !positiveInteger(source.source_version)
    || !nonblank(source.source_content_hash)
    || !(source.display_name === undefined || nullableText(source.display_name))) return null;
  return {
    document_id: source.document_id,
    source_version: source.source_version,
    source_content_hash: source.source_content_hash,
    display_name: nonblank(source.display_name) ? source.display_name : null
  };
}

function parsePreview(value: unknown): McpWikiPreview | null {
  if (!record(value)
    || !keysWithOptional(value, ["schema_version", "complete", "source_documents", "target_pages", "changes"], ["summary"])
    || value.schema_version !== "mcp.wiki-preview.v1"
    || value.complete !== true
    || !Array.isArray(value.source_documents)
    || !Array.isArray(value.target_pages)
    || !Array.isArray(value.changes)
    || !(value.summary === undefined || Array.isArray(value.summary))) return null;
  const sources = value.source_documents.map(parseSourceDocument);
  const targets = value.target_pages.map((target) => {
    if (!record(target) || !exactKeys(target, ["page_id", "version", "content_hash"])
      || !nonblank(target.page_id) || !positiveInteger(target.version) || !nonblank(target.content_hash)) return null;
    return { page_id: target.page_id, version: target.version, content_hash: target.content_hash };
  });
  const changes = value.changes.map(parseChange);
  const summary = ((value.summary ?? []) as unknown[]).map(parseSummaryItem);
  if (sources.some((source) => source === null)
    || summary.some((item) => item === null)
    || targets.some((target) => target === null)
    || changes.some((item) => item === null)
    || new Set(sources.map((source) => source?.document_id)).size !== sources.length
    || new Set(targets.map((target) => target?.page_id)).size !== targets.length
    || new Set(changes.map((item) => item?.change_id)).size !== changes.length) return null;
  const sourceIds = new Set(sources.map((source) => source!.document_id));
  if (changes.some((item) => item!.evidence.some((itemEvidence) => !sourceIds.has(itemEvidence.document_id)))
    || summary.some((item) => item!.evidence.some((itemEvidence) => !sourceIds.has(itemEvidence.document_id)))) return null;
  return {
    schema_version: "mcp.wiki-preview.v1",
    complete: true,
    source_documents: sources as McpWikiPreview["source_documents"],
    target_pages: targets as McpWikiPreview["target_pages"],
    changes: changes as McpWikiChange[],
    summary: summary as McpWikiSummaryItem[]
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

export type McpWikiSummaryEntry =
  | { type: "item"; item: McpWikiSummaryItem }
  /** 문장 없이 온 근거 무효화. 개념마다 한 줄로 묶는다. others: 같은 개념에 문장이 있는 무효화도 있어 "그 외"로 쓴다. */
  | { type: "otherInvalidations"; count: number; others: boolean };
export type McpWikiSummaryGroup = { title: string; entries: McpWikiSummaryEntry[] };

/** 요약을 개념(page_title)별로 처음 나온 순서대로 묶는다. */
export function mcpWikiSummaryGroups(summary: McpWikiSummaryItem[]): McpWikiSummaryGroup[] {
  const groups = new Map<string, { items: McpWikiSummaryItem[]; otherInvalidations: number }>();
  for (const item of summary) {
    const group = groups.get(item.page_title) ?? { items: [], otherInvalidations: 0 };
    if (item.kind === "EVIDENCE_INVALIDATION" && !nonblank(item.text)) group.otherInvalidations += 1;
    else group.items.push(item);
    groups.set(item.page_title, group);
  }
  return [...groups].map(([title, group]) => ({
    title,
    entries: [
      ...group.items.map((item): McpWikiSummaryEntry => ({ type: "item", item })),
      ...(group.otherInvalidations ? [{
        type: "otherInvalidations" as const,
        count: group.otherInvalidations,
        others: group.items.some((item) => item.kind === "EVIDENCE_INVALIDATION")
      }] : [])
    ]
  }));
}

/** 근거 원문 이름. 이름이 없거나 미리보기 원문 목록에 없으면 null(화면은 "원본 문서"로 쓴다). */
export function mcpWikiSourceName(preview: McpWikiPreview, documentId: string): string | null {
  return preview.source_documents.find((source) => source.document_id === documentId)?.display_name ?? null;
}
