import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createRouter, issueAccessToken, listen } from "../mock/lib/http.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

// 위키 페이지는 화면에서 읽기 전용이다. 여기서는 그래프 ETag 조회와, 과거 wiki_edit 로그를 재현하는 mock 저장 라우트만 본다.
const { fetchWikiGraph, resetWikiGraphCache } = await import("../src/entities/wiki/api/wiki.ts");
const { state: mockState } = await import("../mock/state.mjs");
const { registerWikiRoutes } = await import("../mock/routes/wiki.mjs");

function selectWorkspace(t, workspaceId = "ws_test") {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => workspaceId, removeItem() {} } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test("그래프 조회는 받은 ETag를 If-None-Match로 보내고 304면 갖고 있던 그래프를 쓴다", async (t) => {
  selectWorkspace(t);
  resetWikiGraphCache();
  t.after(resetWikiGraphCache);
  const graph = { nodes: [{ id: "n1" }], edges: [] };
  const sent = [];
  const responses = [
    new Response(JSON.stringify(graph), { status: 200, headers: { "Content-Type": "application/json", ETag: "\"wiki-3\"" } }),
    new Response(null, { status: 304 })
  ];
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    sent.push(new Headers(init?.headers).get("If-None-Match"));
    return responses.shift();
  });

  assert.deepEqual(await fetchWikiGraph(), graph);
  assert.deepEqual(await fetchWikiGraph(), graph);
  assert.deepEqual(sent, [null, "\"wiki-3\""]);
});

test("다른 워크스페이스로 바꾸면 이전 ETag를 보내지 않는다", async (t) => {
  resetWikiGraphCache();
  t.after(resetWikiGraphCache);
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    sent.push(new Headers(init?.headers).get("If-None-Match"));
    return new Response(JSON.stringify({ nodes: [], edges: [] }), { status: 200, headers: { ETag: "\"wiki-1\"" } });
  });
  const previous = globalThis.window;
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  globalThis.window = { localStorage: { getItem: () => "ws_a", removeItem() {} } };
  await fetchWikiGraph();
  globalThis.window = { localStorage: { getItem: () => "ws_b", removeItem() {} } };
  await fetchWikiGraph();
  assert.deepEqual(sent, [null, null]);
});

test("mock 본문 저장: 권한·revision 충돌·write ID 재시도·wiki_edit 로그·그래프 ETag를 계약대로 돌려준다", async (t) => {
  const snapshot = {
    workspaces: mockState.workspaces, members: mockState.members, wikiPages: mockState.wikiPages,
    wikiEdges: mockState.wikiEdges, operationLogs: mockState.operationLogs, users: mockState.users
  };
  t.after(() => Object.assign(mockState, snapshot));
  Object.assign(mockState, {
    users: [{ id: "owner" }, { id: "member" }],
    workspaces: [{ id: "ws_1", maintenance: { needs_lint: false, last_lint_at: null, last_wiki_change_at: null } }],
    members: [
      { workspace_id: "ws_1", user_id: "owner", role: "OWNER" },
      { workspace_id: "ws_1", user_id: "member", role: "MEMBER", permissions: [] }
    ],
    wikiPages: [{ id: "p1", workspace_id: "ws_1", page_type: "concept", title: "캐시", slug: "cache", summary: null, status: "active", markdown: "# 캐시" }],
    wikiEdges: [],
    operationLogs: []
  });
  const router = createRouter(mockState);
  registerWikiRoutes(router);
  const server = await listen(router, 0);
  t.mock.method(console, "log", () => {});
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/api/workspaces/ws_1/wiki`;
  const owner = issueAccessToken(mockState, "owner");
  const member = issueAccessToken(mockState, "member");
  const put = (token, body) => fetch(`${base}/pages/p1/content`, {
    method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body)
  });

  const graph = await fetch(`${base}/graph`, { headers: { Authorization: `Bearer ${owner}` } });
  const etag = graph.headers.get("ETag");
  assert.equal(etag, "\"wiki-0\"");
  assert.equal((await fetch(`${base}/graph`, { headers: { Authorization: `Bearer ${owner}`, "If-None-Match": etag } })).status, 304);

  const forbidden = await put(member, { markdown: "# 바뀜", base_revision: 0, revision_write_id: "w0" });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "WORKSPACE_PERMISSION_REQUIRED");

  const saved = await put(owner, { markdown: "# 바뀜", base_revision: 0, revision_write_id: "w1" });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.revision, 1);
  assert.equal(mockState.operationLogs[0].operation_type, "wiki_edit");

  const replay = await put(owner, { markdown: "# 바뀜", base_revision: 0, revision_write_id: "w1" });
  assert.deepEqual(await replay.json(), savedBody);
  const reused = await put(owner, { markdown: "# 또", base_revision: 0, revision_write_id: "w1" });
  assert.equal((await reused.json()).error.code, "IDEMPOTENCY_CONFLICT");

  const stale = await put(owner, { markdown: "# 또", base_revision: 0, revision_write_id: "w2" });
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).error.current_revision, 1);

  const detail = await (await fetch(`${base}/pages/p1`, { headers: { Authorization: `Bearer ${owner}` } })).json();
  assert.equal(detail.revision, 1);
  // 저장으로 위키 버전이 올라 이전 ETag로는 304가 아니다.
  assert.equal((await fetch(`${base}/graph`, { headers: { Authorization: `Bearer ${owner}`, "If-None-Match": etag } })).status, 200);
});
