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

const { deleteWorkspace } = await import("../src/entities/workspace/api/workspace.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerWorkspaceRoutes } = await import("../mock/routes/workspaces.mjs");

test("워크스페이스 삭제는 Idempotency-Key 헤더를 붙여 DELETE한다", async (t) => {
  saveAccessToken("test-access");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls++;
    assert.equal(path, "/api/workspaces/ws_1");
    assert.equal(init.method, "DELETE");
    const key = init.headers.get("Idempotency-Key");
    assert.ok(key && key.length <= 255);
    return new Response(null, { status: 204 });
  });
  await deleteWorkspace("ws_1");
  assert.equal(calls, 1);
});

test("mock 워크스페이스 삭제 라우트는 Idempotency-Key가 없으면 400을 반환한다", async (t) => {
  const timestamp = new Date().toISOString();
  state.users.push({ id: "user_del", email: "del@example.com", display_name: "삭제", provider: "email" });
  state.workspaces.push({ id: "ws_del", name: "삭제 대상", created_at: timestamp, updated_at: timestamp });
  state.members.push({ workspace_id: "ws_del", user_id: "user_del", role: "OWNER", joined_at: timestamp });
  const token = issueAccessToken(state, "user_del");

  const router = createRouter(state);
  registerWorkspaceRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const url = `http://localhost:${server.address().port}/api/workspaces/ws_del`;
  const auth = { Authorization: `Bearer ${token}` };

  const missing = await fetch(url, { method: "DELETE", headers: auth });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error.message, /Idempotency-Key/);
  assert.equal(state.workspaces.find((item) => item.id === "ws_del").deleted_at, undefined);

  const ok = await fetch(url, { method: "DELETE", headers: { ...auth, "Idempotency-Key": "key-1" } });
  assert.equal(ok.status, 204);
  assert.ok(state.workspaces.find((item) => item.id === "ws_del").deleted_at);
});
