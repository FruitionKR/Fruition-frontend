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
function mockServer(t, { enabled = true, unlocked = true, gateStatus = 200, accessCode = "code", verifyFails = false, verifyLimited = 0, phases = [], probes = [] }) {
  const calls = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path === "/access/verify" && method === "POST") {
      if (verifyFails) throw new TypeError("network");
      // 처음 verifyLimited번은 서버 시도 제한(429)으로 응답한다.
      if (verifyLimited > 0) {
        verifyLimited -= 1;
        return new Response(null, { status: 429 });
      }
      const { code } = JSON.parse(init.body);
      return new Response(null, { status: code === accessCode ? 200 : 401 });
    }
    if (path === "/access/verify") return Response.json({ enabled, unlocked }, { status: gateStatus });
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

test("게이트가 켜져 있고 쿠키가 없을 때만 접근 코드 칸을 띄운다", async (t) => {
  await t.test("쿠키 없음", async (t) => {
    mockServer(t, { unlocked: false });
    const hook = render(() => useServerWake());
    await flush();
    assert.equal(hook.rerender().isAccessCodeVisible, true);
  });
  await t.test("게이트 꺼짐: 서버가 /wake를 막으므로 기동 요청·상태 확인도 하지 않는다", async (t) => {
    const calls = mockServer(t, { enabled: false, phases: ["awake"] });
    const hook = render(() => useServerWake());
    await flush();
    hook.result.requestBeforeSubmit();
    await flush();
    assert.equal(hook.rerender().isAccessCodeVisible, false);
    assert.deepEqual(calls, ["GET /access/verify"]);
  });
  await t.test("상태 조회 실패", async (t) => {
    const calls = mockServer(t, { gateStatus: 500 });
    const hook = render(() => useServerWake());
    await flush();
    assert.equal(hook.rerender().isAccessCodeVisible, false);
    assert.deepEqual(calls, ["GET /access/verify"]);
  });
});

test("접근 코드가 맞으면 쿠키를 받은 뒤 기동을 요청하고, 제출 직전에도 요청한다", async (t) => {
  const calls = mockServer(t, { unlocked: false, phases: ["awake"] });
  const hook = render(() => useServerWake());
  await flush();

  assert.equal(await hook.result.unlockAccessCode("  code "), "ok");
  await flush();
  assert.deepEqual(calls, ["GET /access/verify", "POST /access/verify", "POST /wake", "GET /wake"]);
  assert.equal(hook.rerender().isAccessCodeVerified, true);

  hook.result.requestBeforeSubmit();
  await flush();
  assert.equal(calls.filter((call) => call === "POST /wake").length, 2);
});

test("blur와 제출이 겹쳐도 확인은 한 번만 보내고, 틀린 코드는 다시 보내지 않는다", async (t) => {
  const calls = mockServer(t, { unlocked: false });
  const hook = render(() => useServerWake());
  await flush();

  const [first, second] = await Promise.all([hook.result.unlockAccessCode("wrong"), hook.result.unlockAccessCode("wrong")]);
  assert.deepEqual([first, second], ["invalid", "invalid"]);
  assert.equal(await hook.result.unlockAccessCode("wrong"), "invalid");
  assert.equal(calls.filter((call) => call === "POST /access/verify").length, 1);
  assert.equal(calls.includes("POST /wake"), false);
  assert.equal(hook.rerender().isAccessCodeVerified, false);
});

test("네트워크 오류는 코드 불일치와 구분하고 다시 시도할 수 있다", async (t) => {
  const calls = mockServer(t, { unlocked: false, verifyFails: true });
  const hook = render(() => useServerWake());
  await flush();

  assert.equal(await hook.result.unlockAccessCode("code"), "error");
  assert.equal(await hook.result.unlockAccessCode("code"), "error");
  assert.equal(calls.filter((call) => call === "POST /access/verify").length, 2);
});

test("화면을 떠난 뒤 확인이 끝나면 기동 요청을 보내지 않는다", async (t) => {
  const calls = mockServer(t, { unlocked: false });
  const hook = render(() => useServerWake());
  await flush();

  const pending = hook.result.unlockAccessCode("code");
  hook.unmount();
  assert.equal(await pending, "ok");
  await flush();
  assert.equal(calls.includes("POST /wake"), false);
});

test("시도 제한(429)은 rate-limited로 알리고, 같은 코드로 다시 시도할 수 있다", async (t) => {
  const calls = mockServer(t, { unlocked: false, verifyLimited: 1, phases: ["awake"] });
  const hook = render(() => useServerWake());
  await flush();

  assert.equal(await hook.result.unlockAccessCode("code"), "rate-limited");
  assert.equal(calls.includes("POST /wake"), false);
  assert.equal(await hook.result.unlockAccessCode("code"), "ok");
  assert.equal(calls.filter((call) => call === "POST /access/verify").length, 2);
});

test("15분 넘게 준비가 끝나지 않으면 확인을 멈추고 나중에 다시 시도하라고 안내한다", async (t) => {
  // 첫 확인 뒤로는 phase가 비어 unknown이 오고, 안내 중의 unknown은 계속 확인하는 경우다.
  const calls = mockServer(t, { phases: ["waking"] });
  const hook = render(() => useServerWake());
  await flush();
  assert.equal(hook.rerender().isPreparing, true);

  for (let i = 0; i < 89; i += 1) {
    t.mock.timers.tick(10_000);
    await flush();
  }
  assert.equal(hook.rerender().isWakeTimedOut, false);
  t.mock.timers.tick(10_000);
  await flush();
  const view = hook.rerender();
  assert.equal(view.isWakeTimedOut, true);
  assert.equal(view.isPreparing, false);
  assert.equal(view.isServerUnready(), true);

  const before = calls.length;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.length, before);
  assert.equal(calls.filter((call) => call === "GET /wake").length, 91);
});

test("isServerUnready는 렌더 시점이 아니라 최신 준비 상태를 돌려준다", async (t) => {
  mockServer(t, { phases: ["waking", "awake"], probes: [401] });
  const hook = render(() => useServerWake());
  // 첫 렌더 결과(제출 시점처럼 오래된 값)를 그대로 쥐고 있는다.
  const stale = hook.result;
  await flush();
  assert.equal(stale.isPreparing, false);
  assert.equal(stale.isServerUnready(), true);

  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(stale.isServerUnready(), false);
});

/** 탭 가시성을 바꿀 수 있는 최소 document. 훅이 visibilitychange를 구독하는지도 확인한다. */
function fakeDocument(t) {
  const listeners = new Set();
  const fake = {
    visibilityState: "visible",
    addEventListener: (type, listener) => type === "visibilitychange" && listeners.add(listener),
    removeEventListener: (type, listener) => type === "visibilitychange" && listeners.delete(listener),
    setVisibility(state) {
      fake.visibilityState = state;
      listeners.forEach((listener) => listener());
    },
    get listenerCount() {
      return listeners.size;
    }
  };
  globalThis.document = fake;
  t.after(() => delete globalThis.document);
  return fake;
}

test("숨김 탭에서는 상태 확인을 멈추고, 다시 보이면 바로 확인한다", async (t) => {
  const doc = fakeDocument(t);
  const calls = mockServer(t, { phases: ["waking", "waking", "waking"] });
  const hook = render(() => useServerWake());
  await flush();
  const statusChecks = () => calls.filter((call) => call === "GET /wake").length;
  assert.equal(statusChecks(), 1);

  // 다음 확인이 예약된 뒤 탭을 숨기면, 그 확인이 끝난 뒤로는 예약하지 않는다.
  doc.setVisibility("hidden");
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(statusChecks(), 2);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(statusChecks(), 2);

  doc.setVisibility("visible");
  await flush();
  assert.equal(statusChecks(), 3);
  assert.equal(hook.rerender().isPreparing, true);

  hook.unmount();
  assert.equal(doc.listenerCount, 0);
});

test("준비가 끝나 확인을 멈춘 뒤에는 탭을 숨겼다 다시 보여도 확인을 재개하지 않는다", async (t) => {
  const doc = fakeDocument(t);
  const calls = mockServer(t, { phases: ["waking", "awake"], probes: [401] });
  const hook = render(() => useServerWake());
  await flush();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(hook.rerender().isPreparing, false);
  const before = calls.length;

  doc.setVisibility("hidden");
  doc.setVisibility("visible");
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.length, before);
});

test("숨겨서 멈출 때는 확인 횟수를 세지 않는다", async (t) => {
  const doc = fakeDocument(t);
  mockServer(t, { phases: Array.from({ length: 200 }, () => "waking") });
  const hook = render(() => useServerWake());
  await flush();

  // 상한(90회) 직전까지 확인한 뒤 탭을 숨긴다. 멈추는 순간은 횟수에 들어가지 않아 시간 초과 안내가 뜨지 않는다.
  for (let i = 0; i < 89; i += 1) {
    t.mock.timers.tick(10_000);
    await flush();
  }
  doc.setVisibility("hidden");
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(hook.rerender().isWakeTimedOut, false);
  assert.equal(hook.rerender().isPreparing, true);
});
