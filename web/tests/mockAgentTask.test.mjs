import assert from "node:assert/strict";
import test from "node:test";

const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAgentRoutes } = await import("../mock/routes/agent.mjs");
const { registerChatRoutes } = await import("../mock/routes/chat.mjs");

const WORKSPACE_ID = "ws_agent_task";
const USER_ID = "user_agent_task";
const SESSION_ID = "sess_agent_task";
const MODEL = { provider: "openai", model: "gpt-6-luna", allow_web_search: false };
const FOLDER_ID = "0b6f2d4e-1a3c-4e5f-9a7b-8c9d0e1f2a3b";
const DELETED_FOLDER_ID = "1c7a3e5f-2b4d-4f60-8b8c-9d0e1f2a3b4c";

async function startMock(t) {
  const timestamp = new Date().toISOString();
  if (!state.users.some((user) => user.id === USER_ID)) {
    state.users.push({ id: USER_ID, email: "agent-task@example.com", display_name: "작업", provider: "email" });
    state.workspaces.push({ id: WORKSPACE_ID, name: "작업 탭", created_at: timestamp, updated_at: timestamp });
    state.members.push({ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "OWNER", joined_at: timestamp });
    state.chatSessions.push({ id: SESSION_ID, workspace_id: WORKSPACE_ID, title: "작업", created_at: timestamp, last_message_at: timestamp });
    state.folders.push({ id: FOLDER_ID, workspace_id: WORKSPACE_ID, name: "회의록", parent_folder_id: null, sort_order: 0, current_version: 1, created_at: timestamp });
    state.folders.push({ id: DELETED_FOLDER_ID, workspace_id: WORKSPACE_ID, name: "지운 폴더", parent_folder_id: null, sort_order: 1, current_version: 1, created_at: timestamp, deleted_at: timestamp });
    state.documents.push({ id: "doc_task_1", workspace_id: WORKSPACE_ID, filename: "연구.md", status: "completed", document_role: "EDITABLE", markdown: "# 연구" });
    state.skills.push({ id: "skill_task_organize", workspace_id: WORKSPACE_ID, owner_user_id: USER_ID, slug: "file-organize", scope_type: "personal", status: "enabled",
      enabled_version: { id: "sv_task", name: "file-organize", description: "폴더 정리", status: "published", version: 1, allowed_tools: [], capabilities: ["folder-organize"], instructions_markdown: "" },
      latest_version: null });
    state.skills.push({ id: "skill_task_edit", workspace_id: WORKSPACE_ID, owner_user_id: USER_ID, slug: "edit-only", scope_type: "personal", status: "enabled",
      enabled_version: { id: "sv_task_edit", name: "edit-only", description: "문서 수정", status: "published", version: 1, allowed_tools: [], capabilities: ["document-edit"], result_mode: "edit", instructions_markdown: "" },
      latest_version: null });
  }
  const token = issueAccessToken(state, USER_ID);
  const router = createRouter(state);
  registerAgentRoutes(router);
  registerChatRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const workspaceBase = `http://localhost:${server.address().port}/api/workspaces/${WORKSPACE_ID}`;
  const base = `${workspaceBase}/agent`;
  return async (method, path, body) => {
    const response = await fetch(path.startsWith("/chat/") ? `${workspaceBase}${path}` : `${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}

async function waitForTurn(request, turnId) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const turn = await request("GET", `/turn/${turnId}`);
    if (turn.body?.status === "completed") return turn.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("turn이 끝나지 않았습니다.");
}

async function submitTask(request, message) {
  const accepted = await request("POST", "/turn", { session_id: SESSION_ID, message, mode: "task", ...MODEL });
  assert.equal(accepted.status, 202);
  assert.match(accepted.body.requestId, /^agent_/);
  return waitForTurn(request, accepted.body.requestId);
}

test("mock은 문서 없이 보낸 작업 탭 폴더 정리를 받고 원래 요청을 run에 남긴다", async (t) => {
  const request = await startMock(t);
  const turn = await submitTask(request, "완료된 문서를 한 폴더로 정리해줘");
  assert.equal(turn.result.action, "folder_organize");
  const run = await request("GET", `/runs/${turn.result.run_id}`);
  assert.equal(run.body.status, "awaiting_approval");
  assert.equal(run.body.request_summary, "완료된 문서를 한 폴더로 정리해줘");

  const rejected = await request("POST", `/runs/${run.body.id}/reject`);
  assert.equal(rejected.body.status, "rejected");
  assert.equal((await request("POST", `/runs/${run.body.id}/reject`)).status, 409);
});

test("mock 승인은 검토한 버전·해시가 맞을 때만 실행한다", async (t) => {
  const request = await startMock(t);
  const turn = await submitTask(request, "/file-organize 프로젝트 타임라인 폴더");
  assert.equal(turn.result.action, "folder_organize");
  const run = (await request("GET", `/runs/${turn.result.run_id}`)).body;
  assert.equal((await request("POST", `/runs/${run.id}/approve`, { plan_version: 99, operation_hash: run.plan.operation_hash })).status, 409);
  const approved = await request("POST", `/runs/${run.id}/approve`, { plan_version: run.plan.version, operation_hash: run.plan.operation_hash });
  assert.equal(approved.body.status, "executing");
});

test("mock 폴더 정리 계획은 중복 의심 작업을 기본 선택에서 빼고 부분 승인한 작업만 실행한다", async (t) => {
  const request = await startMock(t);
  if (!state.documents.some((doc) => doc.id === "doc_task_2")) {
    state.documents.push({ id: "doc_task_2", workspace_id: WORKSPACE_ID, filename: "회의.md", status: "completed", document_role: "EDITABLE", markdown: "# 회의" });
  }
  const accepted = await request("POST", "/turn", { session_id: SESSION_ID, message: "/file-organize", mode: "task", folder_id: FOLDER_ID, ...MODEL });
  const turn = await waitForTurn(request, accepted.body.requestId);
  const run = (await request("GET", `/runs/${turn.result.run_id}`)).body;
  assert.equal(run.target_folder_id, FOLDER_ID);
  assert.equal(run.rule_summary, "폴더 정리");
  const [create, ...rest] = run.plan.operations;
  const duplicates = rest.filter((operation) => operation.warning?.type === "duplicate_name");
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((operation) => operation.suggested_selected === false));
  const chosen = [create.id, ...rest.filter((operation) => operation.suggested_selected).map((operation) => operation.id)];
  const approve = (operationIds) => request("POST", `/runs/${run.id}/approve`, { plan_version: run.plan.version, operation_hash: run.plan.operation_hash, operation_ids: operationIds });

  const empty = await approve([]);
  assert.equal(empty.status, 400, "형식 오류는 document-svc처럼 400이다");
  assert.equal(empty.body.error.code, "INVALID_REQUEST");
  assert.equal((await approve([create.id, create.id])).status, 400);
  assert.equal((await approve(["opr_unknown"])).status, 400);
  assert.equal((await approve(chosen.slice(1))).status, 400, "새 폴더 작업을 빼면 의존 오류");
  const approved = await approve(chosen);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, "executing");
  for (const operation of approved.body.plan.operations) {
    if (chosen.includes(operation.id)) assert.notEqual(operation.status, "skipped");
    else assert.deepEqual([operation.status, operation.error_code], ["skipped", "not_selected"]);
  }
});

test("mock 폴더 정리 계획은 '내용 중복' 요청이면 duplicate_content 경고와 요약 안내 문장을 붙인다", async (t) => {
  const request = await startMock(t);
  if (!state.documents.some((doc) => doc.id === "doc_task_2")) {
    state.documents.push({ id: "doc_task_2", workspace_id: WORKSPACE_ID, filename: "회의.md", status: "completed", document_role: "EDITABLE", markdown: "# 회의" });
  }
  const accepted = await request("POST", "/turn", { session_id: SESSION_ID, message: "/file-organize 내용 중복", mode: "task", folder_id: FOLDER_ID, ...MODEL });
  const turn = await waitForTurn(request, accepted.body.requestId);
  const run = (await request("GET", `/runs/${turn.result.run_id}`)).body;
  const content = run.plan.operations.filter((operation) => operation.warning?.type === "duplicate_content");
  assert.equal(content.length, 2);
  assert.ok(content.every((operation) => operation.suggested_selected === false && /내용이 거의 같아 중복일 수 있어요\.$/.test(operation.warning.message)));
  assert.equal(run.plan.operations.filter((operation) => operation.warning?.type === "duplicate_name").length, 2);
  assert.match(run.plan.summary, /계획에 없는 문서 중 내용이 거의 같은 문서가 있어요: .+\. 문서 1개는 내용 중복을 확인하지 못했어요\.$/);
});

test("mock 작업 탭은 채팅 답변 대신 되묻고, 문서 없는 편집 요청도 되묻는다", async (t) => {
  const request = await startMock(t);
  const question = await submitTask(request, "아동 발달 이론이 뭐야?");
  assert.equal(question.result.action, "clarify");
  assert.match(question.result.chat.answer, /채팅 탭/);
  const edit = await submitTask(request, "이 문단을 수정해줘");
  assert.equal(edit.result.action, "clarify");
  assert.match(edit.result.chat.answer, /문서를 연 뒤/);
});

test("mock은 문서 필드를 일부만 보내거나 모르는 mode를 거절한다", async (t) => {
  const request = await startMock(t);
  assert.equal((await request("POST", "/turn", { session_id: SESSION_ID, message: "정리", mode: "task", documentId: "doc_task_1", ...MODEL })).status, 400);
  assert.equal((await request("POST", "/turn", { session_id: SESSION_ID, message: "정리", mode: "chat", ...MODEL })).status, 400);
});

test("mock은 작업 대상 폴더(folder_id)를 받아 turn 생성·조회 응답에 돌려준다", async (t) => {
  const request = await startMock(t);
  const accepted = await request("POST", "/turn", { session_id: SESSION_ID, message: "/file-organize", mode: "task", folder_id: FOLDER_ID, ...MODEL });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.folder_id, FOLDER_ID);
  const turn = await waitForTurn(request, accepted.body.requestId);
  assert.equal(turn.folder_id, FOLDER_ID);
  const withoutFolder = await submitTask(request, "새 문서 만들어줘");
  assert.equal(withoutFolder.folder_id, null);
});

test("mock은 UUID가 아닌 folder_id를 400, 없거나 삭제된 폴더를 404로 거절한다", async (t) => {
  const request = await startMock(t);
  const send = (folderId) => request("POST", "/turn", { session_id: SESSION_ID, message: "/file-organize", mode: "task", folder_id: folderId, ...MODEL });
  assert.equal((await send("folder_research")).status, 400);
  assert.equal((await send("2d8b4f60-3c5e-4071-9c9d-0e1f2a3b4c5d")).status, 404);
  assert.equal((await send(DELETED_FOLDER_ID)).status, 404);
});

test("mock 원문 스킬을 폴더에 실행하면 읽을 문서가 없을 때 되묻고, 20개를 넘으면 최근 20개만 읽었다고 알린다", async (t) => {
  const request = await startMock(t);
  const EMPTY_FOLDER_ID = "3e9c5a71-4d6f-4182-8ad0-1f2a3b4c5d6e";
  const FULL_FOLDER_ID = "4fad6b82-5e70-4293-9be1-2a3b4c5d6e7f";
  if (!state.skills.some((skill) => skill.id === "skill_task_source")) {
    const timestamp = new Date().toISOString();
    state.folders.push({ id: EMPTY_FOLDER_ID, workspace_id: WORKSPACE_ID, name: "빈 폴더", parent_folder_id: null, sort_order: 2, current_version: 1, created_at: timestamp });
    state.folders.push({ id: FULL_FOLDER_ID, workspace_id: WORKSPACE_ID, name: "보고서", parent_folder_id: null, sort_order: 3, current_version: 1, created_at: timestamp });
    for (let index = 0; index < 22; index += 1) {
      state.documents.push({ id: `doc_task_src_${index}`, workspace_id: WORKSPACE_ID, folder_id: FULL_FOLDER_ID, filename: `보고 ${index}.md`, status: "completed", document_role: "EDITABLE", markdown: `# 보고 ${index}`, updated_at: new Date(Date.now() - index * 1000).toISOString() });
    }
    state.skills.push({ id: "skill_task_source", workspace_id: WORKSPACE_ID, owner_user_id: USER_ID, slug: "source-summary", scope_type: "personal", status: "enabled",
      enabled_version: { id: "sv_task_source", name: "source-summary", description: "요약", status: "published", version: 1, allowed_tools: [], capabilities: ["document-create"], result_mode: "create", requires_source: true, instructions_markdown: "{문서}를 요약한다." },
      latest_version: null });
  }
  const send = async (folderId) => {
    const accepted = await request("POST", "/turn", { session_id: SESSION_ID, message: "/source-summary", mode: "task", folder_id: folderId, ...MODEL });
    assert.equal(accepted.status, 202);
    return waitForTurn(request, accepted.body.requestId);
  };
  const empty = await send(EMPTY_FOLDER_ID);
  assert.equal(empty.result.action, "clarify");
  assert.match(empty.result.chat.answer, /'빈 폴더' 폴더에 읽을 문서가 없어요/);
  assert.equal(empty.result.generated_markdown, null);

  const full = await send(FULL_FOLDER_ID);
  assert.equal(full.result.action, "markdown_create");
  assert.equal(full.result.message, "폴더 문서 22개 중 최근 수정한 20개만 읽었어요.");
  assert.match(full.result.generated_markdown.markdown, /원문: 20개 문서/);
});

test("mock turn 취소는 진행 중 turn의 pending 응답을 바로 cancelled로 닫고, 멱등이며, 끝난 turn은 409·없는 turn은 404다", async (t) => {
  const request = await startMock(t);
  const turnId = "agent_cancel_mock";
  state.agentTurns.set(turnId, { id: turnId, workspace_id: WORKSPACE_ID, documentId: null, baseVersion: null, apply_operation_id: "apply_cancel_mock", folder_id: null, status: "running", result: null, error_code: null });
  const pending = { id: "msg_cancel_mock", session_id: SESSION_ID, role: "assistant", content: "", status: "pending", created_at: new Date().toISOString(), run_id: turnId, references: [] };
  state.chatMessages.push(pending);
  t.after(() => {
    state.agentTurns.delete(turnId);
    state.chatMessages.splice(state.chatMessages.indexOf(pending), 1);
  });

  const cancelled = await request("POST", `/turn/${turnId}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.requestId, turnId);
  assert.equal(cancelled.body.status, "cancel_requested");
  assert.equal(pending.status, "cancelled");
  assert.equal(pending.error_message, "Agent 작업이 취소되었습니다.");
  // 이미 취소 중이면 상태를 그대로 돌려준다.
  const again = await request("POST", `/turn/${turnId}/cancel`);
  assert.equal(again.status, 200);
  assert.equal(again.body.status, "cancel_requested");

  const finished = await submitTask(request, "폴더 정리해줘");
  const conflict = await request("POST", `/turn/${finished.requestId}/cancel`);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "AGENT_TURN_ALREADY_FINISHED");

  const missing = await request("POST", "/turn/agent_missing/cancel");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "AGENT_RUN_NOT_FOUND");
});

test("mock 작업 탭은 폴더 내용 질문에 folder_lookup으로 바로 아래 폴더·문서 이름을 답한다", async (t) => {
  const request = await startMock(t);
  const childId = "2d8b4f60-3c5e-4a71-9c9d-0e1f2a3b4c5d";
  if (!state.folders.some((folder) => folder.id === childId)) {
    const timestamp = new Date().toISOString();
    state.folders.push({ id: childId, workspace_id: WORKSPACE_ID, name: "2026 회의록", parent_folder_id: FOLDER_ID, sort_order: 0, current_version: 1, created_at: timestamp });
    state.documents.push({ id: "doc_task_lookup", workspace_id: WORKSPACE_ID, folder_id: FOLDER_ID, filename: "킥오프.md", status: "completed", document_role: "EDITABLE", markdown: "# 킥오프" });
  }
  const turn = await submitTask(request, "회의록 폴더에 뭐가 있어?");
  assert.equal(turn.result.action, "folder_lookup");
  assert.equal(turn.result.route.action, "folder_lookup");
  assert.equal(turn.result.run_id, undefined);
  assert.equal(turn.result.edit, null);
  assert.equal(turn.result.message.split("\n\n")[0], "'회의록' 폴더(회의록)에 하위 폴더 1개, 문서 1개가 있어요.");
  assert.match(turn.result.message, /^- 📁 2026 회의록$/m);
  assert.match(turn.result.message, /^- 킥오프$/m);
  const saved = state.chatMessages.find((item) => item.run_id === turn.requestId && item.role === "assistant");
  assert.equal(saved.action, "folder_lookup");
  assert.equal(saved.content, turn.result.message);

  const missing = await submitTask(request, "없는폴더 폴더에 뭐가 있어?");
  assert.equal(missing.result.action, "folder_lookup");
  assert.match(missing.result.message, /폴더 이름을 정확히 적거나 사이드바에서 폴더를 고른/);

  // 메시지에 폴더 이름이 없으면 사이드바에서 고른 폴더를 쓴다.
  const accepted = await request("POST", "/turn", { session_id: SESSION_ID, message: "이 폴더에 뭐가 있어?", mode: "task", folder_id: FOLDER_ID, ...MODEL });
  const selected = await waitForTurn(request, accepted.body.requestId);
  assert.equal(selected.result.action, "folder_lookup");
  assert.match(selected.result.message, /^'회의록' 폴더/);
});

const MARKDOWN_DOCUMENT_QUESTION = "수정할 Markdown 문서를 연 뒤 다시 요청해 주세요.";

test("문서 없는 편집 요청의 되묻기는 turn 결과와 메시지에 이유 코드를 함께 준다(ai agent.md·document chat.md)", async (t) => {
  const request = await startMock(t);
  const { body: accepted } = await request("POST", "/turn", { session_id: SESSION_ID, message: "이 문단을 수정해줘", mode: "task", ...MODEL });
  const { result } = await waitForTurn(request, accepted.requestId);
  assert.equal(result.message, MARKDOWN_DOCUMENT_QUESTION);
  assert.equal(result.clarify_reason, "markdown_document_required");
  const { body: { messages } } = await request("GET", `/chat/sessions/${SESSION_ID}/messages`);
  const assistant = messages.find((item) => item.run_id === accepted.requestId && item.role === "assistant");
  const user = messages.find((item) => item.run_id === accepted.requestId && item.role === "user");
  assert.equal(assistant.clarify_reason, "markdown_document_required");
  assert.equal(user.clarify_reason, null);
});

test("문서 없이 실행한 수정 스킬의 되묻기도 같은 문장과 이유 코드를 준다(ai handle_agent_turn)", async (t) => {
  const request = await startMock(t);
  const { result } = await submitTask(request, "/edit-only 다듬어 줘");
  assert.equal(result.message, MARKDOWN_DOCUMENT_QUESTION);
  assert.equal(result.clarify_reason, "markdown_document_required");
});

test("다른 이유의 되묻기와 되묻기가 아닌 메시지는 이유 코드가 null이고 키는 늘 있다", async (t) => {
  const request = await startMock(t);
  const { body: accepted } = await request("POST", "/turn", { session_id: SESSION_ID, message: "위키에 뭐가 있어?", mode: "task", ...MODEL });
  const { result } = await waitForTurn(request, accepted.requestId);
  assert.equal(result.action, "clarify");
  assert.equal(result.clarify_reason, null);
  const { body: { messages } } = await request("GET", `/chat/sessions/${SESSION_ID}/messages`);
  const assistant = messages.find((item) => item.run_id === accepted.requestId && item.role === "assistant");
  assert.equal(Object.hasOwn(assistant, "clarify_reason"), true);
  assert.equal(assistant.clarify_reason, null);
});
