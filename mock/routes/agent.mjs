// document-svc(8080) Agent 라우트: 문서 편집 turn, 폴더 정리 계획 run, 문서 트리.
import { state, id, hash, error, requireWorkspace, findDocument, upsertMessage, addOperationLog, now } from "../state.mjs";

const TURN_DELAY_MS = 1_500;
const EDIT_PATTERN = /(편집|수정|바꿔|고쳐|다듬|추가해|이어|rewrite|edit|improve)/i;
const ORGANIZE_PATTERN = /(폴더|정리|organize|folder)/i;
const CREATE_PATTERN = /(새 문서|문서 만들|문서를 만들|작성해|create document)/i;

function route(action, reason, extra = {}) {
  return { action, confidence: 0.9, reason, edit_goal: null, edit_operation: null, edit_destination: null, ...extra };
}

function buildEditResult(request) {
  const { target, markdown } = request.editorSnapshot;
  const lines = markdown.split("\n");
  const start = Math.max(1, target.startLine);
  const end = Math.min(lines.length, Math.max(start, target.endLine));
  const original = lines.slice(start - 1, end);
  const replacement = original.map((line) => (line.trim() && !line.startsWith("#") ? `${line} (AI가 다듬음)` : line));
  if (!replacement.some((line) => line.trim())) replacement.push("AI가 추가한 문장입니다.");
  const requested = { type: target.type, start_line: target.startLine, end_line: target.endLine };
  return {
    action: "markdown_edit",
    route: route("markdown_edit", "문서 편집 요청으로 분류", { edit_goal: request.message, edit_operation: "replace", edit_destination: "target" }),
    message: null, chat: null, generated_markdown: null,
    edit: { operation: "replace", requested_target: requested, actual_target: { ...requested, start_line: start, end_line: end }, scope_expanded: false, changed: true, summary: `${end - start + 1}개 줄을 다듬었습니다.`, replacement_markdown: replacement.join("\n") }
  };
}

function buildOrganizePlan(workspace, turn) {
  const docs = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at && doc.status === "completed").slice(0, 2);
  const createOp = { id: id("opr"), sequence: 1, tool_name: "create_folder", target_id: null, source_parent_id: null, destination_parent_id: null, arguments: { name: "정리된 문서", parent_folder_id: null }, reason: "완료된 문서를 한 폴더로 모읍니다.", status: "planned" };
  const moveOps = docs.map((doc, index) => ({ id: id("opr"), sequence: index + 2, tool_name: "move_document", target_id: doc.id, source_parent_id: null, destination_parent_id: null, arguments: { folder_id: { $operation_result: createOp.id } }, reason: `${doc.filename}을 새 폴더로 이동합니다.`, status: "planned" }));
  const operations = [createOp, ...moveOps];
  const plan = { id: id("plan"), version: 1, operation_hash: hash(JSON.stringify(operations)), summary: `폴더 1개 생성, 문서 ${docs.length}개 이동`, status: "awaiting_approval", operations };
  const run = { id: id("run"), workspace_id: workspace.id, turn_id: turn.id, status: "awaiting_approval", error_code: null, plan };
  state.agentRuns.set(run.id, run);
  return run;
}

function completeTurn(workspace, turn, request) {
  const message = request.message;
  const pairId = id("pair");
  let result;
  if (ORGANIZE_PATTERN.test(message)) {
    const run = buildOrganizePlan(workspace, turn);
    result = { action: "folder_organize", route: route("folder_organize", "폴더 정리 요청"), message: "문서를 정리할 계획을 만들었습니다. 승인하면 실행합니다.", chat: null, edit: null, generated_markdown: null, run_id: run.id };
  } else if (CREATE_PATTERN.test(message)) {
    result = { action: "markdown_create", route: route("markdown_create", "새 문서 생성 요청"), message: null, chat: null, edit: null, generated_markdown: { title: "AI 초안", summary: message, markdown: `# AI 초안\n\n요청: ${message}\n\n## 내용\n\nmock 서버가 생성한 초안입니다.\n` } };
  } else if (EDIT_PATTERN.test(message)) {
    result = buildEditResult(request);
  } else {
    const doc = findDocument(workspace.id, request.documentId);
    const answer = `현재 문서 "${doc?.filename ?? request.documentId}"를 기준으로 답합니다.\n\n${message}에 대한 mock 답변입니다. 편집을 원하면 "수정해줘"처럼 요청해보세요.`;
    result = { action: "chat_answer", route: route("chat_answer", "일반 질문"), message: null, chat: { answer }, edit: null, generated_markdown: null };
  }
  upsertMessage(request.session_id, { role: "user", content: message, pair_id: pairId, run_id: turn.id });
  upsertMessage(request.session_id, { role: "assistant", content: result.chat?.answer ?? result.message ?? result.edit?.summary ?? result.generated_markdown?.summary ?? "", pair_id: pairId, run_id: turn.id, action: result.action, related_pages: [] });
  Object.assign(turn, { status: "completed", result });
}

function toTurn(turn) {
  const { id: requestId, documentId, baseVersion, apply_operation_id, status, result, error: turnError } = turn;
  return { requestId, documentId, baseVersion, apply_operation_id, status, result, error: turnError ?? null };
}

function toRun(run) {
  const { id: runId, status, error_code, plan } = run;
  return { id: runId, status, error_code, plan };
}

export function registerAgentRoutes(router) {
  router.post("/api/workspaces/:wid/agent/turn", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const request = await ctx.body();
    if (!request?.documentId || typeof request.message !== "string" || !request.editorSnapshot) return error(ctx, 400, "turn 요청 형식이 올바르지 않습니다.");
    const turn = { id: id("turn"), workspace_id: workspace.id, documentId: request.documentId, baseVersion: request.baseVersion, apply_operation_id: id("apply"), status: "queued", result: null, error_code: null };
    state.agentTurns.set(turn.id, turn);
    addOperationLog(workspace.id, { operation_id: turn.apply_operation_id, operation_type: "document_edit", status: "succeeded", target_document_id: request.documentId, target_display_name: findDocument(workspace.id, request.documentId)?.filename ?? null, summary: request.message.slice(0, 40), changed_resource_count: 0, completed_at: now() });
    setTimeout(() => { if (turn.status === "queued") completeTurn(workspace, turn, request); }, TURN_DELAY_MS);
    ctx.json(202, toTurn(turn));
  });

  router.get("/api/workspaces/:wid/agent/turn/:id", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const turn = state.agentTurns.get(ctx.params.id);
    if (!turn) return error(ctx, 404, "turn을 찾을 수 없습니다.");
    ctx.json(200, toTurn(turn));
  });

  router.get("/api/workspaces/:wid/agent/runs/:id", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const run = state.agentRuns.get(ctx.params.id);
    if (!run) return error(ctx, 404, "run을 찾을 수 없습니다.");
    ctx.json(200, toRun(run));
  });

  router.post("/api/workspaces/:wid/agent/runs/:id/:decision", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const run = state.agentRuns.get(ctx.params.id);
    if (!run) return error(ctx, 404, "run을 찾을 수 없습니다.");
    if (run.status !== "awaiting_approval") return error(ctx, 409, "이미 처리된 계획입니다.");
    if (ctx.params.decision === "reject") {
      run.status = "rejected";
      run.plan.status = "rejected";
      return ctx.json(200, toRun(run));
    }
    if (ctx.params.decision !== "approve") return error(ctx, 404, `mock: unhandled decision ${ctx.params.decision}`);
    const { plan_version, operation_hash } = await ctx.body();
    if (plan_version !== run.plan.version || operation_hash !== run.plan.operation_hash) return error(ctx, 409, "계획이 바뀌었습니다. 최신 상태를 확인해주세요.");
    run.status = "executing";
    run.plan.status = "executing";
    setTimeout(() => {
      run.status = "completed";
      run.plan.status = "completed";
      run.plan.operations.forEach((operation) => { operation.status = "completed"; });
    }, 1500);
    ctx.json(200, toRun(run));
  });

  router.get("/api/workspaces/:wid/document-tree", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const items = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at).map((doc) => ({ id: doc.id, name: doc.filename, type: "document" }));
    ctx.json(200, { items });
  });
}
