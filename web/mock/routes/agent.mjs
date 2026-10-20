// document-svc(8080) Agent 라우트: 문서 편집 turn, 폴더 정리 계획 run.
// mode=task(작업 탭)면 문서 없이도 받고, 채팅 답변 갈래 대신 clarify로 되묻는다(2026-10-19 계약).
import { state, id, hash, sleep, error, requireWorkspace, findDocument, upsertMessage, addOperationLog, now, isMarkdownDocument } from "../state.mjs";
import { legacyRequiresSource } from "./catalog.mjs";

const TURN_DELAY_MS = 1_500;
// 테스트용 시나리오(MOCK_SLOW_TURN=1): 실제 서버처럼 turn을 받자마자 pending 메시지를 남기고 오래 처리한다(입력창 Esc 중지 확인). 기본에는 넣지 않는다.
const SLOW_TURN = process.env.MOCK_SLOW_TURN === "1";
const SLOW_TURN_DELAY_MS = 30_000;
// 취소 요청 뒤 cancel_requested → rolling_back → cancelled로 넘어가는 간격(ai/tasks 취소 mock과 같다).
const CANCEL_STEP_DELAY_MS = 1_000;
const CANCELLING_STATUSES = new Set(["cancel_requested", "rolling_back", "cancelled", "rollback_failed"]);
const AGENT_TURN_CANCELLED_MESSAGE = "Agent 작업이 취소되었습니다.";
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
// 폴더에 원문이 필요한 스킬을 실행하면 바로 아래 Markdown 문서를 최근 수정 순으로 이만큼 읽는다(ai 폴더 원문 규칙).
const FOLDER_SOURCE_LIMIT = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLiveFolder(workspaceId, folderId) {
  return state.folders.some((folder) => folder.id === folderId && folder.workspace_id === workspaceId && !folder.deleted_at);
}

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

const MAX_SELECTED_OPERATIONS = 20;

function duplicateWarning(name) {
  return { type: "duplicate_name", message: `같은 위치에 이름이 같은 문서 '${name}'이(가) 있어 중복일 수 있어요.` };
}

function contentDuplicateWarning(originalName) {
  return { type: "duplicate_content", message: `'${originalName}'와(과) 내용이 거의 같아 중복일 수 있어요.` };
}

/** 요청에 이 문구가 있으면 본문 중복 감지(duplicate_content·요약 안내 문장) 사례를 함께 만든다. 기존 시나리오는 그대로 둔다. */
const CONTENT_DUPLICATE_TRIGGER = "내용 중복";

/**
 * 폴더 생성 + 문서별 이동·이름 변경 계획. 문서가 둘 이상이면 마지막 문서의 새 이름을 첫 문서와 같게 만들어
 * AI 계약의 중복 의심(warning duplicate_name, suggested_selected false)을 흉내 낸다.
 * 요청에 CONTENT_DUPLICATE_TRIGGER가 있으면 첫 문서에 duplicate_content 경고를 붙이고 요약 끝에 AI의 고정 안내 문장을 붙인다.
 */
function organizeSummary(count, withContentDuplicate) {
  const summary = `폴더 1개 생성, 문서 ${count}개 이동·이름 변경`;
  if (!withContentDuplicate) return summary;
  return `${summary}. 계획에 없는 문서 중 내용이 거의 같은 문서가 있어요: '회의록 v1.2.md'와(과) '회의록.md', '참고 자료.pdf'와(과) '참고.pdf'. 문서 1개는 내용 중복을 확인하지 못했어요.`;
}

function buildOrganizePlan(workspace, turn, message, skill) {
  const docs = state.documents.filter((doc) => doc.workspace_id === workspace.id && !doc.deleted_at && doc.status === "completed").slice(0, 3);
  const pick = (extra) => ({ source_parent_id: null, destination_parent_id: null, status: "planned", error_code: null, warning: null, suggested_selected: true, depends_on: [], ...extra });
  const createOp = pick({ id: id("opr"), sequence: 1, tool_name: "create_folder", target_id: null, arguments: { name: "정리된 문서", parent_folder_id: null }, reason: "완료된 문서를 한 폴더로 모읍니다." });
  const operations = [createOp];
  const firstName = docs[0] ? `정리_${docs[0].filename}` : "";
  const withContentDuplicate = message.includes(CONTENT_DUPLICATE_TRIGGER) && docs.length >= 2;
  docs.forEach((doc, index) => {
    const isDuplicate = docs.length >= 2 && index === docs.length - 1;
    const name = isDuplicate ? firstName : `정리_${doc.filename}`;
    const warning = isDuplicate ? duplicateWarning(name)
      : withContentDuplicate && index === 0 ? contentDuplicateWarning(docs[1].filename) : null;
    const move = pick({ id: id("opr"), sequence: operations.length + 1, tool_name: "move_document", target_id: doc.id, arguments: { folder_id: { $operation_result: createOp.id } }, reason: `${doc.filename}을 새 폴더로 이동합니다.`, depends_on: [createOp.id], warning, suggested_selected: !warning });
    operations.push(move);
    operations.push(pick({ id: id("opr"), sequence: operations.length + 1, tool_name: "rename_document", target_id: doc.id, arguments: { document_id: doc.id, display_name: name }, reason: "규칙에 맞게 이름을 바꿉니다.", warning, suggested_selected: !warning }));
  });
  // operation_hash는 실행 내용만 담는다(warning·suggested_selected 제외, AI 계약).
  const hashed = operations.map(({ warning, suggested_selected, ...operation }) => operation);
  const plan = { id: id("plan"), version: 1, operation_hash: hash(JSON.stringify(hashed)), summary: organizeSummary(docs.length, withContentDuplicate), status: "awaiting_approval", operations };
  const run = {
    id: id("run"), workspace_id: workspace.id, turn_id: turn.id, status: "awaiting_approval", error_code: null, request_summary: requestSummary(message),
    target_folder_id: turn.folder_id ?? null, rule_summary: skill?.enabled_version?.description ?? null, plan
  };
  state.agentRuns.set(run.id, run);
  return run;
}

function organizeResult(workspace, turn, message, skill = null) {
  const run = buildOrganizePlan(workspace, turn, message, skill);
  return { action: "folder_organize", route: route("folder_organize", "폴더 정리 요청"), message: "문서를 정리할 계획을 만들었습니다. 승인하면 실행합니다.", chat: null, edit: null, generated_markdown: null, run_id: run.id };
}

/** 부분 승인 operation_ids 검사(AI 계약): 422 형식(빈 배열·20개 초과), 400 중복·계획에 없는 ID·고르지 않은 작업에 의존. */
function selectionError(plan, operationIds) {
  if (!Array.isArray(operationIds) || operationIds.length === 0 || operationIds.length > MAX_SELECTED_OPERATIONS || operationIds.some((value) => typeof value !== "string")) {
    return [422, "operation_ids는 1~20개의 작업 ID여야 합니다."];
  }
  const selected = new Set(operationIds);
  if (selected.size !== operationIds.length) return [400, "operation_ids에 중복된 작업이 있습니다."];
  const known = new Map(plan.operations.map((operation) => [operation.id, operation]));
  if (operationIds.some((operationId) => !known.has(operationId))) return [400, "계획에 없는 작업이 있습니다."];
  for (const operationId of operationIds) {
    const operation = known.get(operationId);
    const referenced = JSON.stringify(operation.arguments).match(/"\$operation_result":"([^"]+)"/g)?.map((match) => match.split('"')[3]) ?? [];
    if ([...(operation.depends_on ?? []), ...referenced].some((dependency) => !selected.has(dependency))) {
      return [400, "고른 작업이 고르지 않은 작업에 의존합니다."];
    }
  }
  return null;
}

/** 폴더 바로 아래 Markdown 문서 전체(최근 수정 순). 원문이 필요한 스킬을 폴더에 실행할 때 앞의 20개를 원문으로 읽는다. */
function folderSourceDocuments(workspaceId, folderId) {
  return state.documents
    .filter((doc) => doc.workspace_id === workspaceId && !doc.deleted_at && (doc.folder_id ?? null) === folderId && isMarkdownDocument(doc))
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
}

/**
 * 폴더 원문 실행(ai agent.md): 읽을 문서가 없으면 초안 없이 clarify로 다른 대상을 고르라고 한다.
 * 20개를 넘으면 최근 수정한 20개만 읽고 결과 message에 그 사실을 덧붙인다.
 */
function folderSourceResult(workspace, folderId, request) {
  const documents = folderSourceDocuments(workspace.id, folderId);
  const folderName = state.folders.find((folder) => folder.id === folderId)?.name ?? "고른";
  if (documents.length === 0) return clarify(`'${folderName}' 폴더에 읽을 문서가 없어요. 다른 대상을 골라 다시 실행해 주세요.`);
  const read = Math.min(documents.length, FOLDER_SOURCE_LIMIT);
  const result = createResult(request, `${read}개 문서`);
  return read < documents.length
    ? { ...result, message: `폴더 문서 ${documents.length}개 중 최근 수정한 ${read}개만 읽었어요.` }
    : result;
}

/**
 * sourceName이 있으면 명시한 스킬이 열린 문서를 원문(source_document)으로 쓴 초안이다(ai _uses_source_document).
 * 폴더 원문이면 sourceName이 "N개 문서"다.
 */
function createResult(message, sourceName = null) {
  const source = sourceName ? `원문: ${sourceName}\n\n` : "";
  return { action: "markdown_create", route: route("markdown_create", "새 문서 생성 요청"), message: null, chat: null, edit: null, generated_markdown: { title: "AI 초안", summary: message, markdown: `# AI 초안\n\n${source}요청: ${message}\n\n## 내용\n\nmock 서버가 생성한 초안입니다.\n` } };
}

/** 작업 탭 요청: 문서 편집·폴더 정리·스킬만 고르고, 채팅 답변 갈래는 clarify로 돌린다. */
function taskResult(workspace, turn, request) {
  const message = request.message;
  const hasDocument = Boolean(request.documentId && request.editorSnapshot);
  const slash = findSlashSkill(workspace, message);
  if (slash) {
    if (slash.skill.enabled_version.capabilities.includes("folder-organize")) return organizeResult(workspace, turn, message, slash.skill);
    // ai agent.md "할 일 없이 /slug만 보낸 턴": 결과 방식대로 정한다. 할 일을 붙이면 그 말을 따른다.
    const version = slash.skill.enabled_version;
    const caps = version.capabilities;
    const mode = version.result_mode ?? (caps.includes("document-create") && !caps.includes("document-edit") ? "create" : caps.includes("document-edit") && !caps.includes("document-create") ? "edit" : "auto");
    const wantsCreate = /새 문서/.test(slash.rest) || (!slash.rest && mode === "create") || (!hasDocument && mode !== "edit");
    // 원문 문서 필요 여부(requires_source). 예전 Skill(저장값 없음)은 조회 규칙으로 계산한 값을 쓴다.
    const requiresSource = typeof version.requires_source === "boolean" ? version.requires_source : legacyRequiresSource(version);
    if (wantsCreate) {
      // 열린 문서(active_markdown_context)가 오면 원문으로 쓴다. 문서 없이 폴더만 오고 원문이 필요하면 폴더 안 문서를 원문으로 읽는다.
      if (hasDocument) return createResult(slash.rest || message, findDocument(workspace.id, request.documentId)?.filename ?? request.documentId);
      if (requiresSource && turn.folder_id) return folderSourceResult(workspace, turn.folder_id, slash.rest || message);
      return createResult(slash.rest || message);
    }
    if (!hasDocument) return clarify("수정할 문서를 열고 다시 실행해 주세요.");
    if (!slash.rest && mode === "auto") return clarify("새 문서로 만들까요, 지금 문서를 수정할까요?");
    return buildEditResult(request);
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
  const answer = { content: result.chat?.answer ?? result.message ?? result.edit?.summary ?? result.generated_markdown?.summary ?? "", action: result.action, related_pages: [] };
  const pending = state.chatMessages.find((item) => item.run_id === turn.id && item.role === "assistant" && item.status === "pending");
  if (pending) {
    Object.assign(pending, answer, { status: "completed" });
  } else {
    upsertMessage(request.session_id, { role: "user", content: message, pair_id: pairId, run_id: turn.id });
    upsertMessage(request.session_id, { role: "assistant", ...answer, pair_id: pairId, run_id: turn.id });
  }
  Object.assign(turn, { status: "completed", result });
}

function toTurn(turn) {
  const { id: requestId, documentId, baseVersion, apply_operation_id, folder_id, status, result, error: turnError } = turn;
  return { requestId, documentId, baseVersion, apply_operation_id, folder_id, status, result, error: turnError ?? null };
}

function toRun(run) {
  const { id: runId, status, error_code, request_summary, target_folder_id, rule_summary, plan } = run;
  return { id: runId, status, error_code, request_summary: request_summary ?? null, target_folder_id: target_folder_id ?? null, rule_summary: rule_summary ?? null, plan };
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
    // 작업 대상 폴더(folder_id): UUID가 아니면 400, 이 워크스페이스의 삭제되지 않은 폴더가 아니면 404(document 계약).
    const folderId = request.folder_id ?? null;
    if (folderId !== null && (typeof folderId !== "string" || !UUID_PATTERN.test(folderId))) return error(ctx, 400, "folder_id 형식이 올바르지 않습니다.");
    if (folderId !== null && !isLiveFolder(workspace.id, folderId)) return error(ctx, 404, "대상 폴더를 찾을 수 없습니다.");
    const turn = { id: id("agent"), workspace_id: workspace.id, documentId: request.documentId ?? null, baseVersion: request.baseVersion ?? null, apply_operation_id: id("apply"), folder_id: folderId, status: "queued", result: null, error_code: null };
    state.agentTurns.set(turn.id, turn);
    if (hasDocument) addOperationLog(workspace.id, { operation_id: turn.apply_operation_id, operation_type: "document_edit", status: "succeeded", target_document_id: request.documentId, target_display_name: findDocument(workspace.id, request.documentId)?.filename ?? null, summary: request.message.slice(0, 40), changed_resource_count: 0, completed_at: now() });
    if (SLOW_TURN) {
      const pairId = id("pair");
      upsertMessage(request.session_id, { role: "user", content: request.message, pair_id: pairId, run_id: turn.id });
      upsertMessage(request.session_id, { role: "assistant", content: "", status: "pending", pair_id: pairId, run_id: turn.id });
    }
    setTimeout(() => { if (turn.status === "queued") completeTurn(workspace, turn, request); }, SLOW_TURN ? SLOW_TURN_DELAY_MS : TURN_DELAY_MS);
    ctx.json(202, toTurn(turn));
  });

  router.get("/api/workspaces/:wid/agent/turn/:id", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const turn = state.agentTurns.get(ctx.params.id);
    if (!turn) return error(ctx, 404, "turn을 찾을 수 없습니다.");
    ctx.json(200, toTurn(turn));
  });

  /**
   * turn 취소(document AgentTurnController). 본문 없음, 200은 GET turn과 같은 모양이다.
   * 진행 중이면 cancel_requested로 바꾸고 pending assistant 메시지를 바로 cancelled로 닫은 뒤 rolling_back을 거쳐 cancelled가 된다.
   * 이미 취소 중·취소됨이면 그 상태 그대로(멱등), 이미 completed·failed면 409, 없거나 남의 워크스페이스 turn이면 404.
   */
  router.post("/api/workspaces/:wid/agent/turn/:id/cancel", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const turn = state.agentTurns.get(ctx.params.id);
    if (!turn || turn.workspace_id !== workspace.id) return error(ctx, 404, "Agent 실행을 찾을 수 없습니다.", "AGENT_RUN_NOT_FOUND");
    if (turn.status === "completed" || turn.status === "failed") return error(ctx, 409, "이미 끝난 Agent 작업입니다.", "AGENT_TURN_ALREADY_FINISHED");
    if (!CANCELLING_STATUSES.has(turn.status)) {
      turn.status = "cancel_requested";
      state.chatMessages
        .filter((message) => message.run_id === turn.id && message.role === "assistant" && message.status === "pending")
        .forEach((message) => Object.assign(message, { status: "cancelled", error_message: AGENT_TURN_CANCELLED_MESSAGE }));
      setTimeout(() => {
        if (turn.status !== "cancel_requested") return;
        turn.status = "rolling_back";
        setTimeout(() => { if (turn.status === "rolling_back") turn.status = "cancelled"; }, CANCEL_STEP_DELAY_MS);
      }, CANCEL_STEP_DELAY_MS);
    }
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
    const { plan_version, operation_hash, operation_ids: operationIds = null } = await ctx.body();
    if (plan_version !== run.plan.version || operation_hash !== run.plan.operation_hash) return error(ctx, 409, "계획이 바뀌었습니다. 최신 상태를 확인해주세요.");
    const invalid = operationIds === null ? null : selectionError(run.plan, operationIds);
    if (invalid) return error(ctx, invalid[0], invalid[1]);
    // 고르지 않은 작업은 승인 시점에 skipped·not_selected가 되고 실행하지 않는다.
    const selected = operationIds === null ? null : new Set(operationIds);
    run.plan.operations.forEach((operation) => {
      if (selected && !selected.has(operation.id)) Object.assign(operation, { status: "skipped", error_code: "not_selected" });
    });
    run.approved_operation_ids = operationIds;
    run.status = "executing";
    run.plan.status = "executing";
    setTimeout(() => {
      run.status = "completed";
      run.plan.status = "completed";
      run.plan.operations.forEach((operation) => { if (operation.status !== "skipped") operation.status = "succeeded"; });
    }, 1500);
    ctx.json(200, toRun(run));
  });
}
