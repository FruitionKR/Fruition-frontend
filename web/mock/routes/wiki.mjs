// document-svc(8080) 위키 라우트: 그래프·페이지 상세·본문 저장·유지보수(lint) 상태.
import { state, error, requireWorkspace, addOperationLog, touchWiki, memberRole, now } from "../state.mjs";
import { startLint } from "../pipeline.mjs";

function toGraphNode(page) {
  const doc = page.source_document_id ? state.documents.find((item) => item.id === page.source_document_id && !item.deleted_at) : null;
  return {
    id: page.id, page_type: page.page_type, title: page.title, slug: page.slug, summary: page.summary, status: page.status,
    ...(page.page_type === "source" && page.source_document_id ? { source_document: { id: page.source_document_id, filename: doc?.filename ?? null } } : {})
  };
}

export function registerWikiRoutes(router) {
  router.get("/api/workspaces/:wid/wiki/graph", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const nodes = state.wikiPages.filter((page) => page.workspace_id === workspace.id).map(toGraphNode);
    const edges = state.wikiEdges.filter((edge) => edge.workspace_id === workspace.id)
      .map(({ from_page_id, to_page_id, link_type, label, confidence }) => ({ from_page_id, to_page_id, link_type, label, confidence }));
    // 위키 버전으로 만든 ETag가 If-None-Match와 같으면 본문 없이 304(document #131).
    const etag = `"wiki-${workspace.wiki_version ?? 0}"`;
    if (ctx.req.headers["if-none-match"] === etag) {
      ctx.status = 304;
      ctx.res.writeHead(304, { ETag: etag });
      ctx.res.end();
      return;
    }
    ctx.json(200, { nodes, edges }, { ETag: etag });
  });

  router.get("/api/workspaces/:wid/wiki/pages/:pageId", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const page = state.wikiPages.find((item) => item.workspace_id === workspace.id && item.id === ctx.params.pageId);
    if (!page) return error(ctx, 404, "Wiki page를 찾을 수 없습니다.");
    const sourceDoc = page.source_document_id ? state.documents.find((doc) => doc.id === page.source_document_id && !doc.deleted_at) : null;
    const related = state.wikiEdges
      .filter((edge) => edge.from_page_id === page.id || edge.to_page_id === page.id)
      .map((edge) => {
        const otherId = edge.from_page_id === page.id ? edge.to_page_id : edge.from_page_id;
        const other = state.wikiPages.find((item) => item.id === otherId);
        return other ? { id: other.id, page_type: other.page_type, title: other.title, slug: other.slug, link_type: edge.link_type, label: edge.label, confidence: edge.confidence } : null;
      })
      .filter(Boolean);
    ctx.json(200, {
      id: page.id, page_type: page.page_type, title: page.title, slug: page.slug, summary: page.summary,
      markdown_uri: `mock://wiki/${page.id}.md`, markdown: page.markdown, status: page.status,
      // 버전 이력이 없는 페이지는 revision 키가 빠진다(document #84).
      ...(page.revision ? { revision: page.revision } : {}),
      ...(page.updated_at ? { updated_at: page.updated_at } : {}),
      source_documents: sourceDoc ? [{ id: sourceDoc.id, filename: sourceDoc.filename, source_uri: sourceDoc.source_uri, relation_type: "derived_from", confidence: 1 }] : [],
      related_pages: related
    });
  });

  // 사람이 고친 본문 저장(document #130). OWNER 또는 wiki.ingest 권한, base_revision 충돌 409, 같은 write ID 재시도는 처음 결과.
  router.put("/api/workspaces/:wid/wiki/pages/:pageId/content", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const member = state.members.find((item) => item.workspace_id === workspace.id && item.user_id === ctx.user.id);
    if (memberRole(workspace.id, ctx.user.id) !== "OWNER" && !member?.permissions?.includes("wiki.ingest")) {
      return error(ctx, 403, "이 작업에는 'wiki.ingest' 권한이 필요합니다.", "WORKSPACE_PERMISSION_REQUIRED");
    }
    const page = state.wikiPages.find((item) => item.workspace_id === workspace.id && item.id === ctx.params.pageId);
    if (!page) return error(ctx, 404, "Wiki page를 찾을 수 없습니다.", "WIKI_PAGE_NOT_FOUND");
    const { markdown, base_revision: baseRevision, revision_write_id: writeId } = await ctx.body();
    if (typeof markdown !== "string" || !Number.isInteger(baseRevision) || baseRevision < 0) {
      return error(ctx, 400, "본문 또는 base_revision이 올바르지 않습니다.", "INVALID_MARKDOWN_CONTENT");
    }
    if (typeof writeId !== "string" || writeId.length < 1 || writeId.length > 255) {
      return error(ctx, 400, "revision_write_id가 올바르지 않습니다.", "INVALID_IDEMPOTENCY_KEY");
    }
    if (Buffer.byteLength(markdown, "utf8") > 5 * 1024 * 1024) {
      return error(ctx, 413, "Markdown은 5MB를 넘을 수 없습니다.", "MARKDOWN_CONTENT_TOO_LARGE");
    }
    page.writes ??= new Map();
    const replay = page.writes.get(writeId);
    if (replay) {
      if (replay.markdown !== markdown || replay.base_revision !== baseRevision) {
        return error(ctx, 409, "같은 revision_write_id를 다른 요청에 썼습니다.", "IDEMPOTENCY_CONFLICT");
      }
      return ctx.json(200, replay.response);
    }
    const currentRevision = page.revision ?? 0;
    if (baseRevision !== currentRevision) {
      return ctx.json(409, { error: { code: "WIKI_PAGE_VERSION_CONFLICT", message: "다른 작업이 먼저 이 페이지를 바꿨습니다.", current_revision: currentRevision } });
    }
    if (process.env.MOCK_WIKI_EDIT_UNAVAILABLE === "1") {
      return error(ctx, 503, "AI 서비스가 본문을 저장하지 못했습니다.", "WIKI_PAGE_PIPELINE_UNAVAILABLE");
    }
    // 같은 본문은 revision을 올리지 않는다.
    if (markdown === page.markdown) {
      return ctx.json(200, { page_id: page.id, revision: currentRevision, updated_at: page.updated_at ?? now(), markdown });
    }
    const previousLines = (page.markdown ?? "").split("\n");
    const nextLines = markdown.split("\n");
    Object.assign(page, { markdown, revision: currentRevision + 1, updated_at: now() });
    addOperationLog(workspace.id, {
      operation_type: "wiki_edit", status: "succeeded", completed_at: now(), summary: `${page.title} 직접 편집`,
      target_display_name: page.title, changed_resource_count: 1,
      changes: [{
        id: 1, resource_type: "wiki_page", resource_id: page.id, resource_display_name: page.title, page_type: page.page_type,
        before_revision: currentRevision, after_revision: page.revision, change_type: "updated", change_summary: "사람이 본문을 고침",
        additions: nextLines.filter((line) => !previousLines.includes(line)).length,
        deletions: previousLines.filter((line) => !nextLines.includes(line)).length
      }]
    });
    touchWiki(workspace);
    const response = { page_id: page.id, revision: page.revision, updated_at: page.updated_at, markdown };
    page.writes.set(writeId, { markdown, base_revision: baseRevision, response });
    ctx.json(200, response);
  });

  router.get("/api/workspaces/:wid/wiki/maintenance/status", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { needs_lint, last_lint_at, last_wiki_change_at } = workspace.maintenance;
    ctx.json(200, { needs_lint, ...(last_lint_at ? { last_lint_at } : {}), ...(last_wiki_change_at ? { last_wiki_change_at } : {}) });
  });

  router.post("/api/workspaces/:wid/wiki/maintenance/lint", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const { dry_run } = await ctx.body();
    const { runId, operationId } = startLint(workspace, dry_run !== false);
    ctx.json(202, operationId ? { run_id: runId, operation_id: operationId } : { run_id: runId });
  });

  router.get("/api/workspaces/:wid/wiki/maintenance/runs/:runId", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const run = state.lintRuns.get(ctx.params.runId);
    if (!run) return error(ctx, 404, "Lint 실행을 찾을 수 없습니다.");
    ctx.json(200, { run_id: run.id, status: run.status, error: run.error, manifest: run.manifest });
  });
}
