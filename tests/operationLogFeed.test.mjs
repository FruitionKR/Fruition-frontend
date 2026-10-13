import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, browserEnv, createResolver, render, setPageVisible } from "./asyncHookShim.mjs";

registerHooks({ resolve: createResolver() });

const { useOperationLogFeed } = await import("../src/widgets/workspace/model/useOperationLogFeed.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");

const LOGS_PATH = "/api/workspaces/ws_test/ai-operation-logs";
const POLL_MS = 5_000;

function log(id, overrides = {}) {
  return {
    operation_id: id,
    operation_type: "document_edit",
    status: "succeeded",
    target_document_id: null,
    target_display_name: null,
    summary: null,
    changed_resource_count: 1,
    restored_from: null,
    created_at: "2026-10-12T00:00:00Z",
    completed_at: null,
    ...overrides
  };
}

/** 로그 목록 API. server.logs를 바꾸면 다음 응답부터 반영되고, 요청 쿼리를 기록한다. */
function logServer(t, initialLogs, { nextCursor = null } = {}) {
  browserEnv(t);
  saveAccessToken("test-access");
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const server = { logs: initialLogs, nextCursor, requests: [], failWith: null, pages: {} };
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.ok(path.startsWith(LOGS_PATH), `예상 밖 요청 ${path}`);
    const query = new URL(path, "http://test").searchParams;
    server.requests.push(Object.fromEntries(query));
    if (server.failWith) return new Response(JSON.stringify({ error: { message: server.failWith } }), { status: 500 });
    const cursor = query.get("cursor");
    if (cursor) return Response.json(server.pages[cursor]);
    return Response.json({ logs: server.logs, next_cursor: server.nextCursor });
  });
  return server;
}

function renderFeed(isActive = true) {
  const props = { isActive };
  const view = render(() => useOperationLogFeed(props.isActive));
  return {
    get feed() { return view.rerender(); },
    setActive(next) { props.isActive = next; view.rerender(); },
    unmount: view.unmount
  };
}

test("로그 뷰를 열면 한 페이지를 받아 가장 최근 작업을 자동으로 고른다", async (t) => {
  const server = logServer(t, [log("op3"), log("op2"), log("op1")], { nextCursor: "c1" });
  const view = renderFeed();

  assert.equal(view.feed.isLoading, true);
  await advance(t, 0);

  const feed = view.feed;
  assert.equal(feed.isLoading, false);
  assert.deepEqual(feed.items.map((item) => item.operation_id), ["op3", "op2", "op1"]);
  assert.equal(feed.selectedOperationId, "op3");
  assert.equal(feed.hasMore, true);
  assert.equal(feed.errorMessage, null);
  assert.deepEqual(server.requests, [{ size: "30" }]);
});

test("5초 폴링으로 새 작업이 위에 들어와도 사용자가 고른 작업은 유지된다", async (t) => {
  const server = logServer(t, [log("op3"), log("op2"), log("op1")]);
  const view = renderFeed();
  await advance(t, 0);

  view.feed.onSelect("op1");
  assert.equal(view.feed.selectedOperationId, "op1");

  server.logs = [log("op4"), log("op3"), log("op2"), log("op1")];
  await advance(t, POLL_MS);

  const feed = view.feed;
  assert.equal(server.requests.length, 2, "5초마다 조용히 다시 받는다");
  assert.deepEqual(feed.items.map((item) => item.operation_id), ["op4", "op3", "op2", "op1"]);
  assert.equal(feed.selectedOperationId, "op1", "폴링이 사용자의 선택을 최신 작업으로 되돌리면 안 된다");
  assert.equal(feed.isLoading, false, "조용한 폴링은 로딩 표시를 켜지 않는다");
});

test("고른 작업이 목록에서 사라지면 가장 최근 작업으로 돌아간다", async (t) => {
  const server = logServer(t, [log("op2"), log("op1", { operation_type: "lint", status: "processing", changed_resource_count: 0 })]);
  const view = renderFeed();
  await advance(t, 0);
  view.feed.onSelect("op1");

  // 아무것도 바꾸지 않고 끝난 lint는 목록에서 숨긴다.
  server.logs = [log("op2"), log("op1", { operation_type: "lint", status: "succeeded", changed_resource_count: 0 })];
  await advance(t, POLL_MS);

  assert.deepEqual(view.feed.items.map((item) => item.operation_id), ["op2"]);
  assert.equal(view.feed.selectedOperationId, "op2");
});

test("복구를 마치면 지정한 작업을 다시 받아 그 작업을 고른다", async (t) => {
  const server = logServer(t, [log("op2"), log("op1")]);
  const view = renderFeed();
  await advance(t, 0);

  server.logs = [log("op3", { operation_type: "restore", restored_from: "op1" }), log("op2"), log("op1")];
  await view.feed.refresh("op3");

  const feed = view.feed;
  assert.equal(feed.selectedOperationId, "op3");
  assert.deepEqual([...feed.restoredOperationIds], ["op1"]);
});

test("숨김 탭에서는 폴링을 멈추고 다시 보이면 즉시 한 번 갱신한 뒤 같은 주기로 재개한다", async (t) => {
  const server = logServer(t, [log("op1")]);
  const view = renderFeed();
  await advance(t, 0);
  assert.equal(server.requests.length, 1);

  setPageVisible(false);
  view.feed;
  await advance(t, POLL_MS * 3);
  assert.equal(server.requests.length, 1, "숨김 탭에서는 요청하지 않는다");

  setPageVisible(true);
  view.feed;
  await advance(t, 0);
  assert.equal(server.requests.length, 2, "복귀 즉시 한 번 받는다");
  await advance(t, POLL_MS);
  assert.equal(server.requests.length, 3, "이후 같은 주기로 폴링한다");
});

test("로그 뷰를 떠나면 폴링을 멈추고 다시 열면 새로 받는다", async (t) => {
  const server = logServer(t, [log("op1")]);
  const view = renderFeed();
  await advance(t, 0);

  view.setActive(false);
  await advance(t, POLL_MS * 2);
  assert.equal(server.requests.length, 1, "닫힌 로그 뷰는 폴링하지 않는다");

  view.setActive(true);
  await advance(t, 0);
  assert.equal(server.requests.length, 2);
});

test("비활성 로그 뷰는 요청하지 않는다", async (t) => {
  const server = logServer(t, [log("op1")]);
  const view = renderFeed(false);
  await advance(t, POLL_MS);

  assert.equal(server.requests.length, 0);
  assert.deepEqual(view.feed.items, []);
  assert.equal(view.feed.selectedOperationId, null);
});

test("첫 로드 실패는 오류 문구를 보여주고 조용한 폴링 실패는 화면을 바꾸지 않는다", async (t) => {
  const server = logServer(t, [log("op1")]);
  server.failWith = "로그 서버 오류";
  const view = renderFeed();
  await advance(t, 0);
  assert.equal(view.feed.errorMessage, "로그 서버 오류");
  assert.equal(view.feed.isLoading, false);

  server.failWith = null;
  await view.feed.refresh();
  assert.equal(view.feed.errorMessage, null);
  assert.deepEqual(view.feed.items.map((item) => item.operation_id), ["op1"]);

  server.failWith = "일시 오류";
  await advance(t, POLL_MS);
  assert.equal(view.feed.errorMessage, null, "조용한 폴링 실패는 오류를 띄우지 않는다");
  assert.deepEqual(view.feed.items.map((item) => item.operation_id), ["op1"]);
});

test("더 보기는 커서로 다음 페이지를 이어붙이고 실패하면 별도 문구를 둔다", async (t) => {
  const server = logServer(t, [log("op3"), log("op2")], { nextCursor: "c1" });
  server.pages.c1 = { logs: [log("op2"), log("op1")], next_cursor: null };
  const view = renderFeed();
  await advance(t, 0);

  view.feed.onLoadMore();
  await advance(t, 0);

  let feed = view.feed;
  assert.deepEqual(server.requests.at(-1), { cursor: "c1", size: "30" });
  assert.deepEqual(feed.items.map((item) => item.operation_id), ["op3", "op2", "op1"], "커서 경계의 중복은 한 번만 남긴다");
  assert.equal(feed.hasMore, false);
  assert.equal(feed.isLoadingMore, false);

  // 다음 페이지가 더 없으면 요청하지 않는다.
  const before = server.requests.length;
  feed.onLoadMore();
  await advance(t, 0);
  assert.equal(server.requests.length, before);

  server.logs = [log("op3"), log("op2")];
  server.nextCursor = "c2";
  await view.feed.refresh();
  server.failWith = "더 못 받음";
  view.feed.onLoadMore();
  await advance(t, 0);
  feed = view.feed;
  assert.equal(feed.loadMoreErrorMessage, "더 못 받음");
  assert.equal(feed.errorMessage, null);
});

test("언마운트하면 폴링 인터벌을 정리한다", async (t) => {
  const server = logServer(t, [log("op1")]);
  const view = renderFeed();
  await advance(t, 0);

  view.unmount();
  await advance(t, POLL_MS * 3);

  assert.equal(server.requests.length, 1);
});
