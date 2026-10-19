import assert from "node:assert/strict";
import test from "node:test";

const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAgentRoutes } = await import("../mock/routes/agent.mjs");

const WORKSPACE_ID = "ws_agent_task";
const USER_ID = "user_agent_task";
const SESSION_ID = "sess_agent_task";
const MODEL = { provider: "openai", model: "gpt-6-luna", allow_web_search: false };

async function startMock(t) {
  const timestamp = new Date().toISOString();
  if (!state.users.some((user) => user.id === USER_ID)) {
    state.users.push({ id: USER_ID, email: "agent-task@example.com", display_name: "작업", provider: "email" });
    state.workspaces.push({ id: WORKSPACE_ID, name: "작업 탭", created_at: timestamp, updated_at: timestamp });
    state.members.push({ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "OWNER", joined_at: timestamp });
    state.chatSessions.push({ id: SESSION_ID, workspace_id: WORKSPACE_ID, title: "작업", created_at: timestamp, last_message_at: timestamp });
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
