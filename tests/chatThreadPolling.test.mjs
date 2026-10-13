import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, browserEnv, createResolver, render, setPageVisible } from "./asyncHookShim.mjs";

registerHooks({
  resolve: createResolver({
    // 사용자 설정 Provider와 알림 카드 UI(tsx)는 훅 실행에 필요 없으므로 shim과 노티스 버스로 바꾼다.
    "@/entities/user": new URL("./asyncHookShim.mjs", import.meta.url).href,
    "@/features/document-notifications": new URL("../src/features/document-notifications/model/noticeBus.ts", import.meta.url).href
  })
});
const { useChatThread } = await import("../src/features/agent-chat/model/useChatThread.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");
const { ERROR_MESSAGES } = await import("../src/shared/api/client.ts");

const POLL_MS = 1_000;

function message(id, role, status = "completed") {
  return { id, role, content: `${id} 본문`, status, references: [] };
}

/** 세션 메시지 API. server.messages를 바꾸면 다음 응답부터 반영되고, 메시지 요청 횟수를 센다. */
function chatServer(t, initialMessages) {
  browserEnv(t);
  saveAccessToken("test-access");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = { messages: initialMessages, messageRequests: 0, failWith: null };
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.match(path, /\/api\/workspaces\/ws_test\/chat\/sessions\/[^/]+\/messages$/, `예상 밖 요청 ${path}`);
    server.messageRequests += 1;
    if (server.failWith) return new Response(null, { status: 500 });
    return Response.json({ messages: server.messages });
  });
  return server;
}

function renderThread(sessionId) {
  const props = { sessionId };
  const view = render(() => useChatThread(props.sessionId));
  return {
    get thread() { return view.rerender(); },
    unmount: view.unmount
  };
}

test("세션을 열면 그 세션의 메시지를 받아 반영한다", async (t) => {
  const server = chatServer(t, [message("m1", "user"), message("m2", "assistant")]);
  const view = renderThread("s1");

  assert.deepEqual(view.thread.messages, []);
  await advance(t, 0);

  const thread = view.thread;
  assert.deepEqual(thread.messages.map((item) => item.id), ["m1", "m2"]);
  assert.equal(thread.chatLoadErrorMessage, null);
  assert.equal(thread.hasPendingMessages, false);
  assert.equal(server.messageRequests, 1);

  // 미완료 문답이 없으면 폴링하지 않는다.
  await advance(t, POLL_MS * 3);
  assert.equal(server.messageRequests, 1);
});

test("미완료 답변이 있으면 1초마다 다시 받고 완료되면 멈춘다", async (t) => {
  const server = chatServer(t, [message("m1", "user"), message("m2", "assistant", "pending")]);
  const view = renderThread("s1");
  await advance(t, 0);
  assert.equal(view.thread.hasPendingMessages, true);

  await advance(t, POLL_MS);
  assert.equal(server.messageRequests, 2);
  await advance(t, POLL_MS);
  assert.equal(server.messageRequests, 3);

  server.messages = [message("m1", "user"), message("m2", "assistant")];
  await advance(t, POLL_MS);
  assert.equal(server.messageRequests, 4);
  assert.equal(view.thread.hasPendingMessages, false);
  assert.equal(view.thread.messages[1].status, "completed");

  await advance(t, POLL_MS * 3);
  assert.equal(server.messageRequests, 4, "완료된 뒤에는 더 받지 않는다");
});

test("숨김 탭에서는 진행 상태 폴링을 멈추고 다시 보이면 이어 받는다", async (t) => {
  const server = chatServer(t, [message("m1", "user"), message("m2", "assistant", "pending")]);
  const view = renderThread("s1");
  await advance(t, 0);

  setPageVisible(false);
  view.thread;
  await advance(t, POLL_MS * 3);
  assert.equal(server.messageRequests, 1, "숨김 탭에서는 요청하지 않는다");

  setPageVisible(true);
  view.thread;
  await advance(t, POLL_MS);
  assert.equal(server.messageRequests, 2, "보이면 같은 주기로 다시 받는다");
});

test("진행 상태 요청이 실패하면 안내 문구를 두고 폴링은 이어 간다", async (t) => {
  const server = chatServer(t, [message("m1", "user"), message("m2", "assistant", "pending")]);
  const view = renderThread("s1");
  await advance(t, 0);
  assert.equal(view.thread.hasPendingMessages, true);

  server.failWith = "server down";
  await advance(t, POLL_MS);
  assert.equal(view.thread.chatLoadErrorMessage, ERROR_MESSAGES.chatLoadFailed);
  assert.equal(view.thread.messages.length, 2, "실패해도 받아 둔 메시지는 유지한다");

  server.failWith = null;
  await advance(t, POLL_MS);
  assert.equal(server.messageRequests, 3);
  assert.equal(view.thread.chatLoadErrorMessage, null, "다음 성공이 문구를 지운다");
});

test("세션 기록을 처음 불러오지 못하면 안내 문구를 둔다", async (t) => {
  const server = chatServer(t, []);
  server.failWith = "server down";
  const view = renderThread("s1");
  await advance(t, 0);

  assert.equal(view.thread.chatLoadErrorMessage, ERROR_MESSAGES.chatLoadFailed);
  assert.deepEqual(view.thread.messages, []);
});

test("패널을 떠나면 진행 상태 폴링을 정리한다", async (t) => {
  const server = chatServer(t, [message("m1", "user"), message("m2", "assistant", "pending")]);
  const view = renderThread("s1");
  await advance(t, 0);
  assert.equal(view.thread.hasPendingMessages, true);
  await advance(t, POLL_MS);
  assert.equal(server.messageRequests, 2);

  view.unmount();
  await advance(t, POLL_MS * 3);

  assert.equal(server.messageRequests, 2);
});
