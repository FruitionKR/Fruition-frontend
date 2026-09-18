// document-svc(8080) 질의 run: SSE 진행 이벤트, 결과 조회, 취소(ai/tasks).
import { state, id, sleep, error, requireWorkspace, upsertMessage } from "../state.mjs";

const STAGE_DELAY_MS = 700;
const STAGES = [
  ["routing", "질문 의도를 분류하는 중"],
  ["retrieval", "위키 그래프에서 관련 페이지를 찾는 중"],
  ["evidence", "원문 근거 블록을 고르는 중"],
  ["generation", "답변을 작성하는 중"]
];

function tokens(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
}

/** 질문 토큰과 페이지 제목·요약이 겹치는 페이지를 관련 페이지로 고른다. 없으면 concept 상위 2개. */
function findRelatedPages(workspaceId, question) {
  const words = tokens(question);
  const pages = state.wikiPages.filter((page) => page.workspace_id === workspaceId);
  const scored = pages
    .map((page) => {
      const haystack = `${page.title} ${page.summary ?? ""} ${page.markdown ?? ""}`.toLowerCase();
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      return { page, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const picked = scored.length ? scored : pages.filter((page) => page.page_type === "concept").slice(0, 2).map((page) => ({ page, score: 0 }));
  return picked.map(({ page, score }, index) => ({
    page,
    relevance_score: Math.max(0.35, Math.min(0.98, 0.6 + score * 0.12 - index * 0.08)),
    role: index === 0 ? "primary" : "supporting",
    depth: index === 0 ? 0 : 1
  }));
}

function buildAnswer(workspace, question, related, allowWebSearch) {
  const sourceDocs = related
    .map(({ page }) => page.source_document_id && state.documents.find((doc) => doc.id === page.source_document_id && !doc.deleted_at))
    .filter(Boolean);
  const evidenceDoc = sourceDocs[0] ?? state.documents.find((doc) => doc.workspace_id === workspace.id && doc.markdown && !doc.deleted_at);
  const evidence = evidenceDoc
    ? [{ rank: 1, source_document_id: evidenceDoc.id, source_block_ids: ["B0002", "B0003"], text: (evidenceDoc.markdown ?? "").split("\n").filter((line) => line && !line.startsWith("#"))[0] ?? evidenceDoc.filename }]
    : [];
  const primary = related[0]?.page;
  const lines = [
    `"${question}"에 대해 워크스페이스 위키를 기준으로 정리했습니다.`,
    "",
    primary ? `**${primary.title}** — ${primary.summary ?? ""}${evidence.length ? "[1]" : ""}` : "관련 위키 페이지를 찾지 못해 일반적인 설명을 드립니다.",
    ...related.slice(1).map(({ page }) => `- ${page.title}: ${page.summary ?? ""}`),
    "",
    allowWebSearch ? "웹 검색 허용 옵션이 켜져 있어 외부 자료도 참고했습니다 (mock)." : "이 답변은 mock 서버가 생성한 예시입니다."
  ];
  return { answer: lines.join("\n"), evidence };
}

export function createQueryRun(workspace, session, question, options) {
  const run = { id: id("query"), workspace_id: workspace.id, session_id: session.id, status: "queued", error_code: null, result: null, question, options, sequence: 0 };
  state.queryRuns.set(run.id, run);
  return run;
}

function completeRun(run) {
  const workspace = state.workspaces.find((item) => item.id === run.workspace_id);
  const related = findRelatedPages(run.workspace_id, run.question);
  const { answer, evidence } = buildAnswer(workspace, run.question, related, run.options.allow_web_search);
  const pairId = id("pair");
  const user = upsertMessage(run.session_id, { role: "user", content: run.question, pair_id: pairId, run_id: run.id });
  const assistant = upsertMessage(run.session_id, {
    role: "assistant", content: answer, pair_id: pairId, run_id: run.id,
    related_pages: related.map(({ page, relevance_score, role, depth }, index) => ({ wiki_page_id: page.id, rank: index + 1, page_type: page.page_type, title: page.title, slug: page.slug, relevance_score, role, depth })),
    references: evidence.map((item) => ({ id: item.rank, reference_type: "evidence", ...item }))
  });
  const summary = ({ id: messageId, role, content, status, created_at, pair_id }) => ({ id: messageId, role, content, status, created_at, pair_id });
  run.result = {
    user_message: summary(user),
    assistant_message: summary(assistant),
    related_pages: related.map(({ page, relevance_score, role, depth }) => ({ id: page.id, page_type: page.page_type, title: page.title, slug: page.slug, relevance_score, role, depth })),
    evidence_snippets: evidence
  };
  run.status = "completed";
}

export function registerQueryRoutes(router) {
  router.get("/api/query/runs/:id/events", async (ctx) => {
    const run = state.queryRuns.get(ctx.params.id);
    if (!run) return error(ctx, 404, "질의 run을 찾을 수 없습니다.");
    const stream = ctx.sse();
    if (run.status === "completed") { stream.send("query.completed", { request_id: run.id }); return stream.close(); }
    run.status = "running";
    for (const [stage, message] of STAGES) {
      await sleep(STAGE_DELAY_MS);
      if (stream.closed()) return;
      if (run.status === "cancel_requested" || run.status === "cancelled") {
        stream.send("query.cancelled", { request_id: run.id });
        return stream.close();
      }
      run.sequence += 1;
      stream.send("query.log", { stage, message, sequence: run.sequence });
    }
    completeRun(run);
    stream.send("query.completed", { request_id: run.id });
    stream.close();
  });

  router.get("/api/query/runs/:id", (ctx) => {
    const run = state.queryRuns.get(ctx.params.id);
    if (!run) return error(ctx, 404, "질의 run을 찾을 수 없습니다.");
    ctx.json(200, { request_id: run.id, status: run.status, result: run.result });
  });

  router.post("/api/workspaces/:wid/ai/tasks/:id/cancel", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const run = state.queryRuns.get(ctx.params.id) ?? state.agentTurns.get(ctx.params.id);
    if (!run) return error(ctx, 404, "작업을 찾을 수 없습니다.");
    if (run.status !== "completed" && run.status !== "cancelled") {
      run.status = "cancel_requested";
      setTimeout(() => { if (run.status === "cancel_requested") run.status = "cancelled"; }, 1000);
    }
    ctx.json(202, { task_id: run.id, status: run.status, error_code: run.error_code ?? null });
  });

  router.get("/api/workspaces/:wid/ai/tasks/:id", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const run = state.queryRuns.get(ctx.params.id) ?? state.agentTurns.get(ctx.params.id);
    if (!run) return error(ctx, 404, "작업을 찾을 수 없습니다.");
    ctx.json(200, { task_id: run.id, status: run.status, error_code: run.error_code ?? null });
  });
}
