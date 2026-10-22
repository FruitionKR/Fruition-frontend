import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { cancelQueryRun, fetchQueryTaskStatus, QueryCancelledError, requestQueryTaskCancel, runQueryStream } = await import("../src/entities/wiki/api/wiki.ts");
const { setActiveChatSession } = await import("../src/entities/chat/api/chat.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const run = { workspaceId: "ws_test", requestId: "query_test" };
const model = { provider: "gemini", model: "test-model" };

function setup(t) {
  globalThis.window = { localStorage: { getItem: () => run.workspaceId, removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  saveAccessToken("query-test-access");
  setActiveChatSession("session_test");
}

function events(text) {
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
}

test("다른 탭의 활성 세션이 바뀌어도 질의는 명시한 채팅 세션에 저장한다", async (t) => {
  setup(t);
  setActiveChatSession("work-session");
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    paths.push(path);
    if (init.method === "POST") return Response.json({ request_id: run.requestId, status: "queued" });
    if (path.endsWith("/events")) return events("event: query.completed\ndata: {}\n\n");
    return Response.json({ status: "completed", result: { answer: "채팅 답변" } });
  });
  const response = await runQueryStream("질문", model, { onStage() {}, sessionContext: { workspaceId: run.workspaceId, sessionId: "chat-session" } });
  assert.equal(response.answer, "채팅 답변");
  assert.equal(paths[0], `/api/workspaces/${run.workspaceId}/chat/sessions/chat-session/query/runs`);
  assert.equal(paths.some(path => path.includes("work-session")), false);
});

test("취소는 생성한 작업의 workspace와 ID를 사용하고 복구 완료까지 조회한다", async (t) => {
  setup(t);
  t.mock.method(globalThis, "setTimeout", (callback) => { callback(); return 0; });
  const calls = [];
  const states = ["cancel_requested", "rolling_back", "cancelled"];
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method ?? "GET"]);
    assert.equal(init.signal, signal);
    assert.equal(init.headers.get("Authorization"), "Bearer query-test-access");
    return Response.json({ id: run.requestId, status: states.shift(), error_code: "" });
  });
  await cancelQueryRun(run, signal);
  assert.deepEqual(calls, [
    ["/api/workspaces/ws_test/ai/tasks/query_test/cancel", "POST"],
    ["/api/workspaces/ws_test/ai/tasks/query_test", "GET"],
    ["/api/workspaces/ws_test/ai/tasks/query_test", "GET"]
  ]);
});

test("복구 실패는 취소 완료로 처리하지 않고 같은 작업으로 재시도한다", async (t) => {
  setup(t);
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/workspaces/ws_test/ai/tasks/query_test/cancel");
    assert.equal(init.method, "POST");
    return Response.json({ status: ++attempts === 1 ? "rollback_failed" : "cancelled", error_code: "rollback_conflict" });
  });
  const signal = new AbortController().signal;
  await assert.rejects(cancelQueryRun(run, signal), /복구하지 못했습니다/);
  await cancelQueryRun(run, signal);
  assert.equal(attempts, 2);
});

test("취소 권한 오류는 성공으로 처리하지 않는다", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "취소 권한이 없습니다." } }, { status: 403 }));
  await assert.rejects(cancelQueryRun(run, new AbortController().signal), /취소 권한/);
});

for (const terminal of ["query.cancelled", "query.completed", "query.failed"]) {
  test(`SSE ${terminal}을 구분하고 생성된 run을 스트림 구독 전에 전달한다`, async (t) => {
    setup(t);
    let started = null;
    let statusCalls = 0;
    const stages = [];
    const signal = new AbortController().signal;
    t.mock.method(globalThis, "fetch", async (path, init) => {
      assert.equal(init.signal, signal);
      if (init.method === "POST") return Response.json({ request_id: run.requestId, status: "queued" });
      assert.deepEqual(started, run);
      if (path.endsWith("/events")) {
        return events(`event: query.log\ndata: {"stage":"search","message":"검색 중","sequence":1}\n\nevent: ${terminal}\ndata: {}\n\n`);
      }
      statusCalls++;
      return Response.json({ status: "completed", result: { answer: "답변" } });
    });
    const result = runQueryStream("질문", model, { onStage: (stage) => stages.push(stage), onStarted: (value) => { started = value; }, signal });
    if (terminal === "query.cancelled") await assert.rejects(result, QueryCancelledError);
    else if (terminal === "query.failed") await assert.rejects(result, /질의에 실패/);
    else assert.equal((await result).answer, "답변");
    assert.equal(statusCalls, terminal === "query.completed" ? 1 : 0);
    assert.equal(stages.length, 1);
  });
}

test("SSE가 종결 이벤트 없이 끊겨도 run이 running이면 실패로 표시하지 않고 완료까지 폴링한다(#143)", async (t) => {
  setup(t);
  t.mock.method(globalThis, "setTimeout", (callback) => { callback(); return 0; });
  const statuses = ["running", "running", "completed"];
  let statusCalls = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init.method === "POST") return Response.json({ request_id: run.requestId, status: "queued" });
    if (path.endsWith("/events")) return events(`event: query.log\ndata: {"stage":"search","message":"검색 중","sequence":1}\n\n`);
    statusCalls++;
    const status = statuses.shift();
    return Response.json({ status, result: status === "completed" ? { answer: "답변" } : null });
  });
  assert.equal((await runQueryStream("질문", model, { onStage() {} })).answer, "답변");
  assert.equal(statusCalls, 3);
});

test("SSE가 끊긴 뒤 run이 failed로 끝나면 실패로 알리고 더 폴링하지 않는다(#143)", async (t) => {
  setup(t);
  t.mock.method(globalThis, "setTimeout", (callback) => { callback(); return 0; });
  let statusCalls = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init.method === "POST") return Response.json({ request_id: run.requestId });
    if (path.endsWith("/events")) return events(": heartbeat\n\n");
    statusCalls++;
    return Response.json({ status: "failed", result: null });
  });
  await assert.rejects(runQueryStream("질문", model, { onStage() {} }), /질의에 실패/);
  assert.equal(statusCalls, 1);
});

test("run이 failed면 document QueryRunStatusResponse의 error 문구를 그대로 보여 준다(#152)", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init.method === "POST") return Response.json({ request_id: run.requestId });
    if (path.endsWith("/events")) return events(": heartbeat\n\n");
    return Response.json({ status: "failed", error: "AI 서비스에 연결하지 못했습니다.", error_code: "provider_unavailable" });
  });
  await assert.rejects(runQueryStream("질문", model, { onStage() {} }), /AI 서비스에 연결하지 못했습니다\./);
});

test("질의 요청이 402 INSUFFICIENT_CREDIT로 거절되면 크레딧 부족 안내로 알리고 스트림을 열지 않는다(#153)", async (t) => {
  setup(t);
  const { getErrorMessage, isInsufficientCreditError } = await import("../src/shared/lib/apiErrors.ts");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { code: "INSUFFICIENT_CREDIT", message: "크레딧이 부족해 작업을 시작하지 않았습니다." } }, { status: 402 });
  });
  await assert.rejects(runQueryStream("질문", model, { onStage() {} }), (error) => {
    assert.equal(isInsufficientCreditError(error), true);
    assert.equal(getErrorMessage(error, "질의에 실패했습니다."), "크레딧이 부족합니다.");
    return true;
  });
  assert.equal(calls, 1);
});

test("SSE 연결 종료 후 상태 조회가 cancelled이면 실패 알림으로 바꾸지 않는다", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (init.method === "POST") return Response.json({ request_id: run.requestId });
    if (path.endsWith("/events")) return events(": heartbeat\n\n");
    return Response.json({ status: "cancelled", result: null });
  });
  await assert.rejects(runQueryStream("질문", model, { onStage() {} }), QueryCancelledError);
});

test("막힌 질의 확인·닫기는 현재 워크스페이스의 AI task를 조회하고 취소를 한 번만 요청한다", async (t) => {
  setup(t);
  const calls = [];
  const responses = [
    Response.json({ id: run.requestId, status: "running", error_code: "" }),
    Response.json({ message: "없음" }, { status: 404 }),
    Response.json({ id: run.requestId, status: "cancel_requested", error_code: "" })
  ];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method ?? "GET"]);
    return responses.shift();
  });
  assert.deepEqual(await fetchQueryTaskStatus(run.requestId), { kind: "status", status: "running" });
  assert.deepEqual(await fetchQueryTaskStatus(run.requestId), { kind: "missing" });
  assert.deepEqual(await requestQueryTaskCancel(run.requestId), { kind: "status", status: "cancel_requested" });
  assert.deepEqual(calls, [
    ["/api/workspaces/ws_test/ai/tasks/query_test", "GET"],
    ["/api/workspaces/ws_test/ai/tasks/query_test", "GET"],
    ["/api/workspaces/ws_test/ai/tasks/query_test/cancel", "POST"]
  ]);
});
