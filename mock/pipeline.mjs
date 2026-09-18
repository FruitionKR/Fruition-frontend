// AI 파이프라인(ingest·변환·lint) 진행 시뮬레이션. 타이머로 상태를 바꿔 폴링 UI가 진행을 보게 한다.
import { state, now, id, hash, slugify, addOperationLog, touchWiki, toDocumentItem } from "./state.mjs";

export const INGEST_DELAY_MS = 5_000;
const CONVERT_DELAY_MS = 3_000;
const LINT_DELAY_MS = 4_000;

/** 문서 본문의 ## 헤딩을 concept 후보로 삼는다. 없으면 파일명 하나를 concept으로 만든다. */
function extractConcepts(doc) {
  const headings = (doc.markdown ?? "").split("\n")
    .map((line) => line.match(/^##\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .slice(0, 3);
  return headings.length ? headings : [doc.filename.replace(/\.[^.]+$/, "")];
}

function ensureConceptPage(workspaceId, title) {
  const existing = state.wikiPages.find((page) => page.workspace_id === workspaceId && page.page_type === "concept" && page.title === title);
  if (existing) return { page: existing, created: false };
  const page = {
    id: id("page"), workspace_id: workspaceId, page_type: "concept", title, slug: slugify(title), status: "published",
    summary: `${title}에 대한 개념 페이지.`, source_document_id: null,
    markdown: `# ${title}\n\n${title} 개념을 설명하는 페이지입니다. Ingest가 자동 생성했습니다.\n`
  };
  state.wikiPages.push(page);
  return { page, created: true };
}

function completeIngest(workspace, doc, log) {
  const title = doc.filename.replace(/\.[^.]+$/, "");
  let source = state.wikiPages.find((page) => page.workspace_id === workspace.id && page.page_type === "source" && page.source_document_id === doc.id);
  const changes = [];
  if (!source) {
    source = { id: id("page"), workspace_id: workspace.id, page_type: "source", title, slug: slugify(title), status: "published", summary: `${title} 문서를 요약한 source 페이지.`, source_document_id: doc.id, markdown: "" };
    state.wikiPages.push(source);
    changes.push({ resource_id: source.id, resource_display_name: title, page_type: "source", before_revision: null, after_revision: 1, change_type: "created", change_summary: "source 페이지 생성" });
  } else {
    changes.push({ resource_id: source.id, resource_display_name: title, page_type: "source", before_revision: 1, after_revision: 2, change_type: "updated", change_summary: "source 페이지 재생성" });
  }
  const concepts = extractConcepts(doc).map((name) => ensureConceptPage(workspace.id, name));
  source.markdown = `# ${title}\n\n${(doc.markdown ?? "").split("\n").filter((line) => line && !line.startsWith("#") && !line.startsWith("<!--")).slice(0, 4).join("\n\n")}\n\n관련 개념: ${concepts.map(({ page }) => `[[${page.title}]]`).join(", ")}\n`;
  for (const { page, created } of concepts) {
    if (!state.wikiEdges.some((edge) => edge.from_page_id === source.id && edge.to_page_id === page.id)) {
      state.wikiEdges.push({ workspace_id: workspace.id, from_page_id: source.id, to_page_id: page.id, link_type: "source_mentions_concept", label: null, confidence: 0.85 });
    }
    if (created) changes.push({ resource_id: page.id, resource_display_name: page.title, page_type: "concept", before_revision: null, after_revision: 1, change_type: "created", change_summary: "concept 페이지 생성" });
  }
  Object.assign(doc, { status: "completed", processing_state: "completed", processing_stage: "done", processed_at: now(), needs_reingest: false, error_message: undefined, extracted_text_uri: `mock://extracted/${doc.id}.txt` });
  Object.assign(log, {
    status: "succeeded", completed_at: now(), changed_resource_count: changes.length,
    summary: `source ${changes.filter((change) => change.page_type === "source").length}개, concept ${changes.filter((change) => change.page_type === "concept").length}개 생성`,
    changes: changes.map((change, index) => ({ id: index + 1, resource_type: "wiki_page", additions: 5, deletions: 0, ...change }))
  });
  touchWiki(workspace);
}

export function startIngest(workspace, doc) {
  Object.assign(doc, { status: "processing", processing_state: "starting", processing_stage: "queued", processing_started_at: now(), error_message: undefined });
  const log = addOperationLog(workspace.id, { operation_type: "ingest", target_document_id: doc.id, target_display_name: doc.filename, summary: "위키 페이지 생성 중" });
  setTimeout(() => { doc.processing_state = "running"; doc.processing_stage = "concept_extraction"; }, INGEST_DELAY_MS / 3);
  setTimeout(() => completeIngest(workspace, doc, log), INGEST_DELAY_MS);
  return log;
}

/** PDF·TXT 원본을 편집 가능한 Markdown 문서로 변환한다. 202 응답용 processing 문서를 즉시 만든다. */
export function startConvert(workspace, source) {
  const filename = source.filename.replace(/\.[^.]+$/, "") + ".md";
  const created = {
    id: id("doc"), workspace_id: workspace.id, filename, mime_type: "text/markdown", byte_size: 0, status: "processing",
    processing_state: "starting", processing_stage: "convert", processing_started_at: now(), document_role: "EDITABLE",
    source_uri: `mock://documents/${source.id}/markdown`, uploaded_at: now(), updated_at: now(),
    markdown: null, content: Buffer.alloc(0), current_version: 0, edit_revision: 0, versions: [], converted_from: source.id
  };
  state.documents.push(created);
  setTimeout(() => {
    const text = source.mime_type === "application/pdf"
      ? `<!-- page 1 -->\n# ${filename.replace(/\.md$/, "")}\n\nPDF에서 변환한 Markdown입니다. (mock 변환 결과)\n\n## 본문\n\n원본 PDF의 문단이 여기에 들어갑니다.\n`
      : `# ${filename.replace(/\.md$/, "")}\n\n${source.content.toString("utf8")}`;
    const buffer = Buffer.from(text, "utf8");
    Object.assign(created, {
      markdown: text, content: buffer, byte_size: buffer.length, status: "uploaded", processing_state: "completed", processing_stage: "done",
      current_version: 1, edit_revision: 1, updated_at: now(),
      versions: [{ version: 1, content_hash: hash(text), created_by: "system", created_at: now(), markdown: text }]
    });
    source.status = "completed";
    source.processed_at = now();
  }, CONVERT_DELAY_MS);
  return toDocumentItem(created);
}

export function startLint(workspace, dryRun) {
  const runId = id("lint");
  const changed = state.wikiPages.filter((page) => page.workspace_id === workspace.id && page.page_type === "concept").slice(0, 2);
  const run = { id: runId, status: "queued", error: null, manifest: null };
  state.lintRuns.set(runId, run);
  const log = dryRun ? null : addOperationLog(workspace.id, { operation_type: "lint", summary: "위키 다듬는 중" });
  setTimeout(() => { run.status = "running"; }, 500);
  setTimeout(() => {
    run.status = "succeeded";
    run.manifest = { task_result: { changed_pages: changed.map((page) => ({ page_id: page.id, title: page.title })) } };
    if (log) {
      Object.assign(log, {
        status: "succeeded", completed_at: now(), changed_resource_count: changed.length, summary: `${changed.length}개 페이지 다듬음`,
        changes: changed.map((page, index) => ({ id: index + 1, resource_type: "wiki_page", resource_id: page.id, resource_display_name: page.title, page_type: "concept", before_revision: 1, after_revision: 2, change_type: "updated", change_summary: "문장 정리", additions: 2, deletions: 1 }))
      });
      workspace.maintenance.needs_lint = false;
      workspace.maintenance.last_lint_at = now();
    }
  }, LINT_DELAY_MS);
  return runId;
}

/** 서버 시작 시 seed의 processing 문서가 실제로 끝나도록 예약한다. */
export function scheduleSeedProcessing() {
  for (const doc of state.documents.filter((item) => item.status === "processing")) {
    const workspace = state.workspaces.find((item) => item.id === doc.workspace_id);
    const log = addOperationLog(workspace.id, { operation_type: "ingest", target_document_id: doc.id, target_display_name: doc.filename, summary: "위키 페이지 생성 중", created_at: doc.processing_started_at });
    setTimeout(() => completeIngest(workspace, doc, log), INGEST_DELAY_MS * 2);
  }
}
