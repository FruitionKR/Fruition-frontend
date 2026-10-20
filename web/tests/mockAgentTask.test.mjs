import assert from "node:assert/strict";
import test from "node:test";

const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAgentRoutes } = await import("../mock/routes/agent.mjs");

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
  }
  const token = issueAccessToken(state, USER_ID);
  const router = createRouter(state);
  registerAgentRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/workspaces/${WORKSPACE_ID}/agent`;
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
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

  assert.equal((await approve([])).status, 422);
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

test("mock 작업 탭은 채팅 답변 대신 되묻고, 문서 없는 편집 요청도 되묻는다", async (t) => {
  const request = await startMock(t);
  const question = await submitTask(request, "아동 발달 이론이 뭐야?");
  assert.equal(question.result.action, "clarify");
  assert.match(question.result.chat.answer, /채팅 탭/);
  const edit = await submitTask(request, "이 문단을 수정해줘");
  assert.equal(edit.result.action, "clarify");
  assert.match(edit.result.chat.answer, /문서를 열고/);
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
