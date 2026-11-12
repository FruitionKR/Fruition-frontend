// document-svc(8080) MCP 위키 초안 승인 화면 라우트. 화면 확인용으로 INGEST·LINT·요약 없는(배포 전) 초안을 하나씩 둔다.
// 열기: /mcp/workspaces/ws_fruition/wiki-drafts/draft_ingest_demo (draft_lint_demo, draft_legacy_demo, draft_published_demo, draft_invalidated_demo)
import { error, requireWorkspace } from "../state.mjs";
import { sha256 } from "../lib/sourceBlocks.mjs";

const source = (document_id, display_name) => ({ document_id, source_version: 1, source_content_hash: sha256(document_id), display_name });
const item = (kind, page_title, fields = {}) => ({
  kind, page_id: fields.page_id === undefined ? `page_${page_title}` : fields.page_id, page_title,
  text: fields.text ?? null, before_text: fields.before_text ?? null, related_page_title: fields.related_page_title ?? null,
  evidence: fields.evidence ?? []
});
const evidence = (document_id, block_id, quote) => ({ document_id, block_id, quote });

const INGEST_SUMMARY = [
  item("SOURCE_PAGE", "아키텍처 개요", { page_id: "page_src_arch", text: "아키텍처 개요 문서의 최신 내용을 원문 페이지에 반영해요." }),
  item("CONCEPT_CREATE", "Markdown 변환", { page_id: null }),
  item("STATEMENT_ADD", "Markdown 변환", {
    page_id: null,
    text: "PDF 같은 원본 문서는 위키에 편입하기 전에 Markdown으로 변환한다.",
    evidence: [evidence("doc_arch", "B0004", "PDF 등 원본 문서는 먼저 Markdown 변환을 거칩니다.")]
  }),
  item("STATEMENT_UPDATE", "Ingest", {
    page_id: "page_c_ingest",
    before_text: "편집 가능한 Markdown을 입력으로 받아 source/concept 페이지를 생성한다.",
    text: "편집 가능한 Markdown만 입력으로 받아 source·concept 페이지를 만든다.",
    evidence: [
      evidence("doc_arch", "B0004", "Ingest는 편집 가능한 Markdown만 입력으로 받습니다."),
      evidence("doc_intro", "B0004", "2. Ingest 파이프라인이 문서를 분석해 source 페이지와 concept 페이지를 생성한다.")
    ]
  }),
  item("LINK_ADD", "Ingest", { page_id: "page_c_ingest", related_page_title: "Markdown 변환" }),
  item("EVIDENCE_INVALIDATION", "Lint", { page_id: "page_c_lint", text: "Lint는 위키 페이지를 다듬는다." }),
  item("EVIDENCE_INVALIDATION", "Lint", { page_id: "page_c_lint" }),
  item("EVIDENCE_INVALIDATION", "Lint", { page_id: "page_c_lint" })
];

const LINT_SUMMARY = [
  item("CONCEPT_MERGE", "RAG 검색", { page_id: "page_c_rag", related_page_title: "검색 증강 생성" }),
  item("STATEMENT_REMOVE", "Lint", { page_id: "page_c_lint", text: "마지막 실행 이후 변경된 페이지를 정리한다." }),
  item("STATEMENT_ADD", "Lint", {
    page_id: "page_c_lint",
    text: "마지막 실행 이후 바뀐 위키 페이지를 다듬고 중복 개념을 병합한다.",
    evidence: [evidence("doc_arch", "B0005", "Lint는 마지막 실행 이후 바뀐 위키 페이지를 다듬고 중복 개념을 병합합니다.")]
  }),
  item("LINK_REMOVE", "워크스페이스", { page_id: "page_c_workspace", related_page_title: "Ingest" }),
  item("CONCEPT_DELETE", "임시 메모", { page_id: "page_c_temp" })
];

function draft(draft_id, draft_kind, sources, summary) {
  const ingest = draft_kind === "INGEST";
  return {
    schema_version: "mcp.wiki-web-draft.v1",
    draft_id,
    draft_kind,
    draft_version: 1,
    draft_hash: sha256(`${draft_id}:draft`),
    public_state_hash: sha256(`${draft_id}:public`),
    client_name: "Claude Code",
    quote: {
      pricing_model: ingest ? "INGEST_SOURCE_QUANTITY" : "LINT_FIXED_APPLY",
      currency: "KRW",
      price_version: "wiki-mcp-v1",
      quantity: ingest ? sources.length : 1,
      unit: ingest ? "원문 문서" : "적용",
      formula: ingest ? `원문 문서 ${sources.length}개 × 50원` : "적용 1회 × 100원",
      maximum_charge_minor: ingest ? sources.length * 50 : 100
    },
    preview: {
      schema_version: "mcp.wiki-preview.v1",
      complete: true,
      source_documents: sources,
      // 현재 document는 위키 본문(changes)과 내부 hash(target_pages)를 보내지 않는다.
      // 요약 없는 레거시 초안만 배포 전 document처럼 두 필드를 보내, 프론트가 받아서 버리는지 확인한다.
      ...(summary ? { summary } : {
        target_pages: [{ page_id: "page_c_ingest", version: 3, content_hash: sha256("page_c_ingest") }],
        changes: [{
          change_id: `${draft_id}_change_1`, kind: "PAGE_BODY", action: "UPDATE", page_id: "page_c_ingest", subject_id: null,
          before_text: "# Ingest\n\n위키 본문은 승인 화면에 보이지 않아야 한다.\n", after_text: "# Ingest\n\n위키 본문은 승인 화면에 보이지 않아야 한다(수정).\n", evidence: []
        }]
      })
    },
    approval: { status: "AWAITING", reason: null },
    publication: { status: "NOT_STARTED", changed: null, published_reference_hash: null, committed_at: null, error_code: null },
    settlement: { status: "NOT_RESERVED", charged_minor: 0 }
  };
}

function seedDrafts() {
  const legacySources = [source("doc_arch")].map(({ display_name: _omit, ...legacy }) => legacy);
  return new Map([
    ["draft_ingest_demo", draft("draft_ingest_demo", "INGEST", [source("doc_arch", "아키텍처 개요.md"), source("doc_intro", null)], INGEST_SUMMARY)],
    ["draft_lint_demo", draft("draft_lint_demo", "LINT", [source("doc_arch", "아키텍처 개요.md")], LINT_SUMMARY)],
    ["draft_legacy_demo", draft("draft_legacy_demo", "INGEST", legacySources, null)],
    // 승인 뒤 상태 확인용: 반영·청구가 끝난 초안과 더 이상 승인할 수 없는 초안
    ["draft_published_demo", {
      ...draft("draft_published_demo", "LINT", [source("doc_arch", "아키텍처 개요.md")], LINT_SUMMARY),
      approval: { status: "EXECUTING", reason: null },
      publication: { status: "PUBLISHED", changed: true, published_reference_hash: sha256("draft_published_demo"), committed_at: new Date().toISOString(), error_code: null },
      settlement: { status: "SETTLED", charged_minor: 100 }
    }],
    ["draft_invalidated_demo", {
      ...draft("draft_invalidated_demo", "INGEST", [source("doc_arch", "아키텍처 개요.md")], INGEST_SUMMARY.slice(0, 3)),
      approval: { status: "INVALIDATED", reason: "원문 문서가 그 사이에 바뀌었어요. Claude Code에서 다시 제안해 주세요." }
    }]
  ]);
}

const drafts = seedDrafts();

function findDraft(ctx) {
  if (!requireWorkspace(ctx)) return null;
  const found = ctx.params.wid === "ws_fruition" ? drafts.get(ctx.params.id) : null;
  if (!found) error(ctx, 404, "위키 초안을 찾을 수 없습니다.", "MCP_WIKI_DRAFT_NOT_FOUND");
  return found ?? null;
}

export function registerMcpWikiDraftRoutes(router) {
  router.get("/api/workspaces/:wid/mcp/wiki-drafts/:id", (ctx) => {
    const found = findDraft(ctx);
    if (found) ctx.json(200, found);
  });

  // 승인하면 바로 공개·정산된 것으로 둔다. 거절·취소는 상태만 바꾼다.
  router.post("/api/workspaces/:wid/mcp/wiki-drafts/:id/approve", (ctx) => {
    const found = findDraft(ctx);
    if (!found) return;
    found.approval = { status: "EXECUTING", reason: null };
    found.publication = { status: "PUBLISHED", changed: true, published_reference_hash: sha256(found.draft_id), committed_at: new Date().toISOString(), error_code: null };
    found.settlement = { status: "SETTLED", charged_minor: found.quote.maximum_charge_minor };
    ctx.json(200, found);
  });

  router.post("/api/workspaces/:wid/mcp/wiki-drafts/:id/reject", (ctx) => {
    const found = findDraft(ctx);
    if (!found) return;
    found.approval = { status: "REJECTED", reason: null };
    ctx.json(200, found);
  });

  router.post("/api/workspaces/:wid/mcp/wiki-drafts/:id/cancel", (ctx) => {
    const found = findDraft(ctx);
    if (!found) return;
    found.publication = { ...found.publication, status: "HALTED" };
    ctx.json(200, found);
  });
}
