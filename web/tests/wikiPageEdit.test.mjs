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

const { fetchWikiGraph, resetWikiGraphCache, saveWikiPageContent, WikiPageVersionConflictError } = await import("../src/entities/wiki/api/wiki.ts");
const {
  buildWikiPageSaveRequest, canEditWikiPage, createWikiPageEditSession, describeWikiPageSaveError,
  isWikiPageIdempotencyConflict, prepareWikiPageSave, rebaseWikiPageEditSession
} = await import("../src/features/wiki-page-editing/model/wikiPageEdit.ts");
const { ApiError, getErrorMessage, INSUFFICIENT_CREDIT_MESSAGE } = await import("../src/shared/lib/apiErrors.ts");
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

test("OWNER는 항상, MEMBER는 wiki.ingest가 있을 때만 편집할 수 있고 역할을 모르면 막는다", () => {
  assert.equal(canEditWikiPage("OWNER", []), true);
  assert.equal(canEditWikiPage("MEMBER", ["wiki.ingest"]), true);
  assert.equal(canEditWikiPage("MEMBER", ["wiki.lint"]), false);
  assert.equal(canEditWikiPage(null, ["wiki.ingest"]), false);
});

test("편집 세션은 페이지 revision을 base로 잡고 이력이 없으면 0으로 보낸다", () => {
  const session = createWikiPageEditSession({ markdown: "# 제목", revision: 3 }, "w1");
  assert.deepEqual(buildWikiPageSaveRequest(session), { markdown: "# 제목", base_revision: 3, revision_write_id: "w1" });
  assert.equal(createWikiPageEditSession({ markdown: "본문" }, "w2").baseRevision, 0);
});

test("같은 본문을 다시 저장하면 write ID를 유지하고, 보낸 뒤 더 고쳤으면 새로 만든다", () => {
  const first = prepareWikiPageSave({ ...createWikiPageEditSession({ markdown: "a", revision: 1 }, "w1"), draft: "b" }, "unused");
  assert.equal(first.writeId, "w1");
  assert.equal(first.sentDraft, "b");
  // 503 뒤 같은 본문 재시도
  assert.equal(prepareWikiPageSave(first, "unused").writeId, "w1");
  // 실패 뒤 본문을 더 고친 저장
  const edited = prepareWikiPageSave({ ...first, draft: "c" }, "w2");
  assert.equal(edited.writeId, "w2");
  assert.equal(edited.sentDraft, "c");
});

test("충돌 뒤 다시 저장은 내 편집을 유지한 채 최신 revision과 새 write ID를 쓴다", () => {
  const session = { draft: "내 편집", baseRevision: 2, writeId: "w1", sentDraft: "내 편집" };
  assert.deepEqual(rebaseWikiPageEditSession(session, 5, "w2"), { draft: "내 편집", baseRevision: 5, writeId: "w2", sentDraft: null });
});

test("저장 실패 문구: 403·402는 공통 문구, 503·413·404는 편집 화면 문구", () => {
  const forbidden = new ApiError("이 작업에는 'wiki.ingest' 권한이 필요합니다.", 403, "WORKSPACE_PERMISSION_REQUIRED");
  // 403 문구는 앱 공통 getErrorMessage 경로를 그대로 쓴다.
  assert.equal(describeWikiPageSaveError(forbidden), getErrorMessage(forbidden, "Wiki page를 저장하지 못했습니다."));
  assert.equal(describeWikiPageSaveError(new ApiError("x", 402, "INSUFFICIENT_CREDIT")), INSUFFICIENT_CREDIT_MESSAGE);
  assert.match(describeWikiPageSaveError(new ApiError("x", 503, "WIKI_PAGE_PIPELINE_UNAVAILABLE")), /다시 저장/);
  assert.match(describeWikiPageSaveError(new ApiError("x", 413, "MARKDOWN_CONTENT_TOO_LARGE")), /5MB/);
  assert.equal(isWikiPageIdempotencyConflict(new ApiError("x", 409, "IDEMPOTENCY_CONFLICT")), true);
  assert.equal(isWikiPageIdempotencyConflict(new ApiError("x", 409, "WIKI_PAGE_VERSION_CONFLICT")), false);
});

test("본문 저장은 PUT content로 보내고 409 버전 충돌의 current_revision을 보존한다", async (t) => {
  selectWorkspace(t);
  const calls = [];
  const responses = [
    Response.json({ page_id: "p1", revision: 4, updated_at: "2026-10-14T00:00:00Z", markdown: "# 새" }),
    Response.json({ error: { code: "WIKI_PAGE_VERSION_CONFLICT", message: "충돌", current_revision: 5 } }, { status: 409 }),
    Response.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "재사용" } }, { status: 409 })
  ];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, method: init?.method, body: JSON.parse(init?.body) });
    return responses.shift();
  });
  const request = { markdown: "# 새", base_revision: 3, revision_write_id: "w1" };

  assert.equal((await saveWikiPageContent("p1", request)).revision, 4);
  assert.deepEqual(calls[0], { path: "/api/workspaces/ws_test/wiki/pages/p1/content", method: "PUT", body: request });

  const conflict = await saveWikiPageContent("p1", request).catch((error) => error);
  assert.ok(conflict instanceof WikiPageVersionConflictError);
  assert.equal(conflict.currentRevision, 5);

  const reused = await saveWikiPageContent("p1", request).catch((error) => error);
  assert.ok(!(reused instanceof WikiPageVersionConflictError));
  assert.equal(reused.code, "IDEMPOTENCY_CONFLICT");
});

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
