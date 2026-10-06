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
function mockServer(t, { enabled = true, unlocked = true, gateStatus = 200, accessCode = "code", verifyFails = false, phases = [], probes = [] }) {
  const calls = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path === "/access/verify" && method === "POST") {
      if (verifyFails) throw new TypeError("network");
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
  await t.test("게이트 꺼짐", async (t) => {
    mockServer(t, { enabled: false, phases: ["awake"] });
    const hook = render(() => useServerWake());
    await flush();
    assert.equal(hook.rerender().isAccessCodeVisible, false);
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
