import assert from "node:assert/strict";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";

/** mock 서버가 MOCK_INSUFFICIENT_CREDIT=1일 때 AI 작업 시작 경로만 402 INSUFFICIENT_CREDIT로 거절하는지 확인한다(#153). */
test("mock은 환경변수로 AI 작업 시작 경로를 402 INSUFFICIENT_CREDIT로 거절한다", async (t) => {
  const state = { tokens: new Map(), users: [{ id: "user_1" }] };
  const router = createRouter(state);
  const handled = [];
  router.post("/api/workspaces/:wid/chat/sessions/:sid/query/runs", (ctx) => { handled.push("query"); ctx.json(202, {}); });
  router.get("/api/workspaces/:wid/agent/turn/:id", (ctx) => { handled.push("turn-get"); ctx.json(200, {}); });
  router.post("/api/workspaces/:wid/chat/sessions", (ctx) => { handled.push("session"); ctx.json(200, {}); });
  const server = await listen(router, 0);
  const port = server.address().port;
  const token = issueAccessToken(state, "user_1");
  const original = process.env.MOCK_INSUFFICIENT_CREDIT;
  process.env.MOCK_INSUFFICIENT_CREDIT = "1";
  t.mock.method(console, "log", () => {});
  t.after(() => {
    if (original === undefined) delete process.env.MOCK_INSUFFICIENT_CREDIT;
    else process.env.MOCK_INSUFFICIENT_CREDIT = original;
    server.close();
  });
  const request = (method, path) => fetch(`http://localhost:${port}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });

  const rejected = await request("POST", "/api/workspaces/ws_1/chat/sessions/s_1/query/runs");
  assert.equal(rejected.status, 402);
  assert.equal((await rejected.json()).error.code, "INSUFFICIENT_CREDIT");
  // AI 작업이 아닌 요청과 상태 조회는 그대로 처리한다.
  assert.equal((await request("GET", "/api/workspaces/ws_1/agent/turn/t_1")).status, 200);
  assert.equal((await request("POST", "/api/workspaces/ws_1/chat/sessions")).status, 200);
  assert.deepEqual(handled, ["turn-get", "session"]);

  process.env.MOCK_INSUFFICIENT_CREDIT = "";
  assert.equal((await request("POST", "/api/workspaces/ws_1/chat/sessions/s_1/query/runs")).status, 202);
});
