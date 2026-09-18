// document-svc(8080) 위키 라우트: 그래프·페이지 상세·유지보수(lint) 상태.
import { state, error, requireWorkspace } from "../state.mjs";
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
    ctx.json(200, { nodes, edges });
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
      source_documents: sourceDoc ? [{ id: sourceDoc.id, filename: sourceDoc.filename, source_uri: sourceDoc.source_uri, relation_type: "derived_from", confidence: 1 }] : [],
      related_pages: related
    });
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
    ctx.json(202, { run_id: startLint(workspace, dry_run !== false) });
  });

  router.get("/api/workspaces/:wid/wiki/maintenance/runs/:runId", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const run = state.lintRuns.get(ctx.params.runId);
    if (!run) return error(ctx, 404, "Lint 실행을 찾을 수 없습니다.");
    ctx.json(200, { run_id: run.id, status: run.status, error: run.error, manifest: run.manifest });
  });
}
