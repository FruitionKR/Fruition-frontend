import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 경로 별칭을 같은 소스로 해석하고, react는 1회 렌더 shim으로 바꿔 훅을 실제로 실행한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") {
      return nextResolve(new URL("./reactHookShim.mjs", import.meta.url).href, context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { render } = await import("./reactHookShim.mjs");
const { useServerWake } = await import("../src/views/login/model/useServerWake.ts");

// setImmediate는 가짜 타이머 대상이 아니라 대기 중인 fetch 체인을 끝까지 흘려보낼 수 있다.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** 경로별 응답 순서를 정해 fetch를 대체하고, 보낸 요청을 기록한다. */
function mockServer(t, { unlocked = true, phases = [], probes = [] }) {
  const calls = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path === "/access/verify") return Response.json({ enabled: true, unlocked });
    if (path === "/wake" && method === "POST") return new Response(null, { status: 204 });
    if (path === "/wake") return Response.json({ phase: phases.shift() ?? "unknown" });
    if (path === "/api/auth/me") return new Response(null, { status: probes.shift() ?? 401 });
    throw new Error(`예상하지 못한 요청 ${path}`);
  });
  return calls;
}

test("접근 코드를 통과하지 않은 브라우저는 기동 요청도 상태 확인도 하지 않는다", async (t) => {
  const calls = mockServer(t, { unlocked: false });
  const hook = render(() => useServerWake());
  await flush();
  hook.result.requestBeforeSubmit();
  await flush();

  assert.deepEqual(calls, ["GET /access/verify"]);
  assert.equal(hook.rerender().isPreparing, false);
});

test("깨어 있으면 기동 요청만 보내고 안내 없이 확인을 끝낸다", async (t) => {
  const calls = mockServer(t, { phases: ["awake"] });
  const hook = render(() => useServerWake());
  await flush();

  assert.deepEqual(calls, ["GET /access/verify", "POST /wake", "GET /wake"]);
  assert.equal(hook.rerender().isPreparing, false);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(calls.length, 3);
});

test("waking이면 안내를 띄우고, awake와 앱 응답을 확인한 뒤 안내를 내린다", async (t) => {
  const calls = mockServer(t, { phases: ["waking", "awake", "awake"], probes: [503, 401] });
  const hook = render(() => useServerWake());
  await flush();
  assert.equal(hook.rerender().isPreparing, true);

  // awake지만 앱이 아직 503이면 안내를 유지한다.
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(hook.rerender().isPreparing, true);

  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(hook.rerender().isPreparing, false);
  assert.equal(calls.filter((call) => call === "GET /api/auth/me").length, 2);
});

test("asleep이면 확인할 때마다 기동을 다시 요청하고, 제출 직전에도 요청한다", async (t) => {
  const calls = mockServer(t, { phases: ["asleep"] });
  const hook = render(() => useServerWake());
  await flush();
  hook.result.requestBeforeSubmit();
  await flush();

  assert.equal(calls.filter((call) => call === "POST /wake").length, 3);
  assert.equal(hook.rerender().isPreparing, true);
});

test("화면을 떠나면 예약된 상태 확인을 멈춘다", async (t) => {
  const calls = mockServer(t, { phases: ["waking", "waking"] });
  const hook = render(() => useServerWake());
  await flush();
  const before = calls.length;

  hook.unmount();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(calls.length, before);
});
