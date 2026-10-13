import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
}});
const { requestAgentTurn } = await import("../src/features/agent-chat/api/agent.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { readRunEvents } = await import("../src/shared/lib/runEventStream.ts");

const encoder = new TextEncoder();
const frame = (event, data) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

test("Agent는 최종 응답 전에 실제 단계를 전달하고 편집 원문을 그대로 반환한다", async (t) => {
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  saveAccessToken("agent-test-access");
  let stream;
  let finishStage;
  const stageReceived = new Promise((resolve) => { finishStage = resolve; });
  const stages = [];
  const result = { action: "markdown_edit", edit: { replacement_markdown: "# 원문\n- \n" }, message: "스킬 없이 작성했어요." };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(path);
    assert.equal(init.headers.get("Authorization"), "Bearer agent-test-access");
    assert.ok(init.signal);
    if (init.method === "POST") return Response.json({ requestId: "agent_1", status: "queued" });
    if (path.endsWith("/events")) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    return Response.json({ requestId: "agent_1", status: "completed", result });
  });
  let completed = false;
  const pending = requestAgentTurn({ message: "정리해줘" }, {
    signal: new AbortController().signal,
    onStage: (stage) => { stages.push(stage); finishStage(); }
  }).then((value) => { completed = true; return value; });
  while (!stream) await new Promise((resolve) => setImmediate(resolve));
  const stage = { sequence: 1, stage: "agent.generating", message: "편집안을 작성하고 있어요." };
  const bytes = encoder.encode(frame("query.log", stage));
  stream.enqueue(bytes.slice(0, bytes.length - 1));
  stream.enqueue(bytes.slice(bytes.length - 1));
  await stageReceived;
  assert.equal(completed, false);
  assert.deepEqual(stages, [stage]);
  stream.enqueue(encoder.encode(frame("query.log", stage) + frame("query.completed", {})));
  assert.deepEqual((await pending).result, result);
  assert.equal(stages.length, 1);
  assert.deepEqual(calls, ["/api/workspaces/ws_test/agent/turn", "/api/workspaces/ws_test/agent/turn/agent_1/events", "/api/workspaces/ws_test/agent/turn/agent_1"]);
});

for (const [status, pattern] of [["cancelled", /취소되었습니다/], ["rollback_failed", /변경 복구에 실패/]]) {
  test(`SSE가 끊긴 뒤 조회한 ${status}는 연결 종료 안내가 아니라 취소·복구 실패로 알린다(#141)`, async (t) => {
    globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
    t.after(() => { delete globalThis.window; });
    saveAccessToken("agent-test-access");
    t.mock.method(globalThis, "fetch", async (path, init) => {
      if (init.method === "POST") return Response.json({ requestId: "agent_1", status: "queued" });
      if (path.endsWith("/events")) return new Response(": heartbeat\n\n");
      return Response.json({ requestId: "agent_1", status, result: null, error: "rollback_conflict" });
    });
    await assert.rejects(requestAgentTurn({ message: "정리해줘" }, { signal: new AbortController().signal, onStage() {} }), pattern);
  });
}

test("에이전트 실패는 error 코드가 아니라 error_message를 보여 주고, 없으면 기본 문구로 안내한다(#152)", async (t) => {
  globalThis.window = { localStorage: { getItem: () => "ws_test", removeItem() {} } };
  t.after(() => { delete globalThis.window; });
  saveAccessToken("agent-test-access");
  let body = { requestId: "agent_1", status: "failed", result: null, error: "provider_unavailable", error_message: "AI 서비스에 일시적인 장애가 있습니다." };
  t.mock.method(globalThis, "fetch", async () => Response.json(body));
  const options = () => ({ signal: new AbortController().signal, onStage() {} });
  await assert.rejects(requestAgentTurn({ message: "정리해줘" }, options()), /일시적인 장애/);
  body = { requestId: "agent_1", status: "failed", result: null, error: "provider_unavailable" };
  await assert.rejects(requestAgentTurn({ message: "정리해줘" }, options()), (error) => {
    assert.equal(error.message, "AI 편집 요청에 실패했습니다.");
    return true;
  });
});

for (const event of ["query.failed", "query.cancelled"]) {
  test(`진행 스트림은 ${event}를 성공으로 표시하지 않는다`, async () => {
    const pending = readRunEvents(new Response(frame(event, { error: "처리 실패" })), () => {}, "오류");
    if (event === "query.failed") await assert.rejects(pending, /처리 실패/);
    else assert.equal(await pending, "cancelled");
  });
}
