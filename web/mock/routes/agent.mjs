// document-svc(8080) Agent 라우트: 문서 편집 turn, 폴더 정리 계획 run.
// mode=task(작업 탭)면 문서 없이도 받고, 채팅 답변 갈래 대신 clarify로 되묻는다(2026-10-19 계약).
import { state, id, hash, sleep, error, requireWorkspace, findDocument, upsertMessage, addOperationLog, now } from "../state.mjs";

const TURN_DELAY_MS = 1_500;
const TURN_STAGE_DELAY_MS = 500;
// 실제 AgentTurnController의 SSE(query.log → query.completed)를 흉내 낸다. 단계 이름은 설명용이다.
const TURN_STAGES = [
  ["intake", "요청을 확인하는 중"],
  ["routing", "처리 유형을 정하는 중"],
  ["drafting", "편집안을 작성하는 중"]
];
const EDIT_PATTERN = /(편집|수정|바꿔|고쳐|다듬|추가해|이어|rewrite|edit|improve)/i;
const ORGANIZE_PATTERN = /(폴더|정리|organize|folder)/i;
const CREATE_PATTERN = /(새 문서|문서 만들|문서를 만들|작성해|create document)/i;
const SLASH_SKILL_PATTERN = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;
const TASK_MODE = "task";
const REQUEST_SUMMARY_MAX = 80;

function requestSummary(message) {
  const text = message.trim().replace(/\s+/g, " ");
  return text.length > REQUEST_SUMMARY_MAX ? `${text.slice(0, REQUEST_SUMMARY_MAX)}…` : text;
}

function clarify(message) {
  return { action: "clarify", route: route("clarify", "되물음"), message, chat: { answer: message }, edit: null, generated_markdown: null };
}

/** "/slug 요청"이면 그 스킬과 나머지 요청을 돌려준다. */
function findSlashSkill(workspace, message) {
  const match = message.trim().match(SLASH_SKILL_PATTERN);
  if (!match) return null;
  const skill = state.skills.find((item) => item.workspace_id === workspace.id && item.slug === match[1] && item.enabled_version);
  return skill ? { skill, rest: match[2]?.trim() ?? "" } : null;
}

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

function buildOrganizePlan(workspace, turn, message) {
  const docs = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at && doc.status === "completed").slice(0, 2);
  const createOp = { id: id("opr"), sequence: 1, tool_name: "create_folder", target_id: null, source_parent_id: null, destination_parent_id: null, arguments: { name: "정리된 문서", parent_folder_id: null }, reason: "완료된 문서를 한 폴더로 모읍니다.", status: "planned" };
  const moveOps = docs.map((doc, index) => ({ id: id("opr"), sequence: index + 2, tool_name: "move_document", target_id: doc.id, source_parent_id: null, destination_parent_id: null, arguments: { folder_id: { $operation_result: createOp.id } }, reason: `${doc.filename}을 새 폴더로 이동합니다.`, status: "planned" }));
  const operations = [createOp, ...moveOps];
  const plan = { id: id("plan"), version: 1, operation_hash: hash(JSON.stringify(operations)), summary: `폴더 1개 생성, 문서 ${docs.length}개 이동`, status: "awaiting_approval", operations };
  const run = { id: id("run"), workspace_id: workspace.id, turn_id: turn.id, status: "awaiting_approval", error_code: null, request_summary: requestSummary(message), plan };
  state.agentRuns.set(run.id, run);
  return run;
}

function organizeResult(workspace, turn, message) {
  const run = buildOrganizePlan(workspace, turn, message);
  return { action: "folder_organize", route: route("folder_organize", "폴더 정리 요청"), message: "문서를 정리할 계획을 만들었습니다. 승인하면 실행합니다.", chat: null, edit: null, generated_markdown: null, run_id: run.id };
}

function createResult(message) {
  return { action: "markdown_create", route: route("markdown_create", "새 문서 생성 요청"), message: null, chat: null, edit: null, generated_markdown: { title: "AI 초안", summary: message, markdown: `# AI 초안\n\n요청: ${message}\n\n## 내용\n\nmock 서버가 생성한 초안입니다.\n` } };
}

/** 작업 탭 요청: 문서 편집·폴더 정리·스킬만 고르고, 채팅 답변 갈래는 clarify로 돌린다. */
function taskResult(workspace, turn, request) {
  const message = request.message;
  const hasDocument = Boolean(request.documentId && request.editorSnapshot);
  const slash = findSlashSkill(workspace, message);
  if (slash) {
    if (slash.skill.enabled_version.capabilities.includes("folder-organize")) return organizeResult(workspace, turn, message);
    if (hasDocument) return buildEditResult(request);
    return createResult(slash.rest || message);
  }
  if (ORGANIZE_PATTERN.test(message)) return organizeResult(workspace, turn, message);
  if (CREATE_PATTERN.test(message)) return createResult(message);
  if (EDIT_PATTERN.test(message)) {
    return hasDocument ? buildEditResult(request) : clarify("어느 문서를 고칠까요? 고칠 문서를 열고 다시 요청해 주세요.");
  }
  return clarify("작업 탭은 문서 편집·폴더 정리·스킬 실행을 맡아요. 위키 내용 질문은 채팅 탭에서 해 주세요.");
}

function completeTurn(workspace, turn, request) {
  const message = request.message;
  const pairId = id("pair");
  let result;
  if (request.mode === TASK_MODE) {
    result = taskResult(workspace, turn, request);
  } else if (ORGANIZE_PATTERN.test(message)) {
    result = organizeResult(workspace, turn, message);
  } else if (CREATE_PATTERN.test(message)) {
    result = createResult(message);
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
  const { id: runId, status, error_code, request_summary, plan } = run;
  return { id: runId, status, error_code, request_summary: request_summary ?? null, plan };
}

export function registerAgentRoutes(router) {
  router.post("/api/workspaces/:wid/agent/turn", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const request = await ctx.body();
    // 실제 서버처럼 문서 필드(documentId·baseVersion·editorSnapshot)는 함께 오거나 함께 빠져야 한다.
    const hasDocument = Boolean(request?.documentId);
    if (typeof request?.message !== "string" || !request.message.trim() || hasDocument !== Boolean(request.editorSnapshot)) return error(ctx, 400, "turn 요청 형식이 올바르지 않습니다.");
    if (request.mode !== undefined && request.mode !== TASK_MODE) return error(ctx, 400, "mode는 task만 받을 수 있습니다.");
    const turn = { id: id("agent"), workspace_id: workspace.id, documentId: request.documentId ?? null, baseVersion: request.baseVersion ?? null, apply_operation_id: id("apply"), status: "queued", result: null, error_code: null };
    state.agentTurns.set(turn.id, turn);
    if (hasDocument) addOperationLog(workspace.id, { operation_id: turn.apply_operation_id, operation_type: "document_edit", status: "succeeded", target_document_id: request.documentId, target_display_name: findDocument(workspace.id, request.documentId)?.filename ?? null, summary: request.message.slice(0, 40), changed_resource_count: 0, completed_at: now() });
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

  /** turn 진행 단계 SSE. 실제 서버와 같이 query.log를 보내고 query.completed·query.cancelled로 끝낸다. */
  router.get("/api/workspaces/:wid/agent/turn/:id/events", async (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const turn = state.agentTurns.get(ctx.params.id);
    if (!turn) return error(ctx, 404, "turn을 찾을 수 없습니다.");
    const stream = ctx.sse();
    const isTerminal = () => turn.status === "completed" || turn.status === "cancelled";
    const isCancelling = () => turn.status === "cancel_requested" || turn.status === "rolling_back" || turn.status === "cancelled";
    const finish = () => {
      stream.send(turn.status === "completed" ? "query.completed" : "query.cancelled", { request_id: turn.id });
      stream.close();
    };
    if (isTerminal()) return finish();
    let sequence = 0;
    for (const [stage, message] of TURN_STAGES) {
      await sleep(TURN_STAGE_DELAY_MS);
      if (stream.closed()) return;
      if (isCancelling()) break;
      sequence += 1;
      stream.send("query.log", { stage, message, sequence });
    }
    // 처리 또는 취소 복구(rolling_back)가 끝날 때까지 기다린 뒤 종료 이벤트를 보낸다.
    while (!isTerminal()) {
      await sleep(TURN_STAGE_DELAY_MS);
      if (stream.closed()) return;
    }
    finish();
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
      run.plan.operations.forEach((operation) => { operation.status = "succeeded"; });
    }, 1500);
    ctx.json(200, toRun(run));
  });
}
