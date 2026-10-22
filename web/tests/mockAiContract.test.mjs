import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Node 테스트에서도 앱의 TypeScript 경로 별칭을 같은 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { exportChatWiki } = await import("../src/features/wiki-export/api/export.ts");
const { setActiveChatSession } = await import("../src/entities/chat/api/chat.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAgentRoutes } = await import("../mock/routes/agent.mjs");
const { registerChatRoutes } = await import("../mock/routes/chat.mjs");
const { registerQueryRoutes } = await import("../mock/routes/query.mjs");

const WORKSPACE_ID = "ws_contract";
const USER_ID = "user_contract";
const SESSION_ID = "sess_contract";

/** mock 서버를 띄우고 멤버 토큰으로 호출할 수 있는 base URL과 헤더를 돌려준다. */
async function startMock(t) {
  const timestamp = new Date().toISOString();
  if (!state.users.some((user) => user.id === USER_ID)) {
    state.users.push({ id: USER_ID, email: "contract@example.com", display_name: "계약", provider: "email" });
    state.workspaces.push({ id: WORKSPACE_ID, name: "계약 검증", created_at: timestamp, updated_at: timestamp });
    state.members.push({ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "OWNER", joined_at: timestamp });
    state.chatSessions.push({ id: SESSION_ID, workspace_id: WORKSPACE_ID, title: "계약", created_at: timestamp, last_message_at: timestamp });
  }
  const token = issueAccessToken(state, USER_ID);
  const router = createRouter(state);
  registerAgentRoutes(router);
  registerChatRoutes(router);
  registerQueryRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  return { base: `http://localhost:${server.address().port}`, auth: { Authorization: `Bearer ${token}` } };
}

test("mock 취소는 200과 id를 돌려주고 cancel_requested → rolling_back → cancelled로 진행한다", async (t) => {
  const { base, auth } = await startMock(t);
  // completed 상태도 복구 대상이다. 실제 서버는 cancelled·rolling_back만 건너뛴다.
  state.queryRuns.set("query_done", { id: "query_done", workspace_id: WORKSPACE_ID, status: "completed", error_code: null, sequence: 0 });

  const cancelled = await fetch(`${base}/api/workspaces/${WORKSPACE_ID}/ai/tasks/query_done/cancel`, { method: "POST", headers: auth });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(await cancelled.json(), { id: "query_done", status: "cancel_requested", error_code: "" });

  const seen = new Set(["cancel_requested"]);
  const deadline = Date.now() + 5_000;
  while (!seen.has("cancelled") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await fetch(`${base}/api/workspaces/${WORKSPACE_ID}/ai/tasks/query_done`, { headers: auth });
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.id, "query_done");
    seen.add(body.status);
  }
  assert.deepEqual([...seen], ["cancel_requested", "rolling_back", "cancelled"]);
});

test("mock agent turn은 /events SSE로 query.log를 보낸 뒤 query.completed로 끝낸다", async (t) => {
  const { base, auth } = await startMock(t);
  state.agentTurns.set("turn_sse", { id: "turn_sse", workspace_id: WORKSPACE_ID, documentId: "doc_1", baseVersion: 1, apply_operation_id: "apply_1", status: "queued", result: null, error_code: null });
  setTimeout(() => { state.agentTurns.get("turn_sse").status = "completed"; }, 300);

  const response = await fetch(`${base}/api/workspaces/${WORKSPACE_ID}/agent/turn/turn_sse/events`, { headers: { ...auth, Accept: "text/event-stream" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  const events = [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
  assert.ok(events.includes("query.log"));
  assert.equal(events.at(-1), "query.completed");

  const missing = await fetch(`${base}/api/workspaces/${WORKSPACE_ID}/agent/turn/turn_none/events`, { headers: auth });
  assert.equal(missing.status, 404);
});

test("mock 대화 내보내기는 pair_ids가 비면 400이고 selection_mode를 보지 않는다", async (t) => {
  const { base, auth } = await startMock(t);
  state.chatMessages.push(
    { id: "msg_u", session_id: SESSION_ID, role: "user", content: "질문", pair_id: "pair_1", status: "completed", created_at: new Date().toISOString() },
    { id: "msg_a", session_id: SESSION_ID, role: "assistant", content: "답변", pair_id: "pair_1", status: "completed", created_at: new Date().toISOString() }
  );
  const url = `${base}/api/workspaces/${WORKSPACE_ID}/chat/sessions/${SESSION_ID}/wiki`;
  const headers = { ...auth, "Content-Type": "application/json" };

  const empty = await fetch(url, { method: "POST", headers, body: JSON.stringify({ selection_mode: "full", pair_ids: [] }) });
  assert.equal(empty.status, 400);

  const saved = await fetch(url, { method: "POST", headers, body: JSON.stringify({ pair_ids: ["pair_1"] }) });
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).status, "saved");
});

test("exportChatWiki는 문답과 함께 내보내기 연결 UUID·선택 모드를 보낸다", async (t) => {
  globalThis.window = { localStorage: { getItem: () => "ws_front", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  saveAccessToken("test-access");
  setActiveChatSession("sess_front");
  let body;
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    body = JSON.parse(init.body);
    return Response.json({ exportDocumentId: "doc_x", status: "saved" });
  });
  await exportChatWiki(["pair_a", "pair_b"]);
  assert.deepEqual(body.pair_ids, ["pair_a", "pair_b"]);
  assert.equal(body.mode, "selected");
  assert.match(body.export_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(body.selection_mode, undefined);
});
