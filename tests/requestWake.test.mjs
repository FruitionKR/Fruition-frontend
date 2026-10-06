import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";

// next/server는 확장자까지 적어야 해석된다. @/ 별칭은 src/로, AWS SDK는 대역으로 바꿔 실제 AWS를 부르지 않는다.
const fakeSdk = new URL("./fakeAwsSdk.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "@aws-sdk/client-eventbridge" || specifier === "@aws-sdk/client-dynamodb") {
      return nextResolve(fakeSdk, context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    // 앱 소스(app/·src/)의 확장자 없는 상대 import만 .ts로 해석한다. node_modules의 CJS require는 건드리지 않는다.
    const fromAppSource = /\/(app|src)\//.test(context.parentURL ?? "") && !context.parentURL.includes("/node_modules/");
    if (fromAppSource && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const { NextRequest } = await import("next/server");
const { fake } = await import("./fakeAwsSdk.mjs");
const { GET, POST } = await import("../app/wake/route.ts");
const { ACCESS_COOKIE, hashAccessCode } = await import("../src/shared/lib/accessCode.ts");

const WAKE_ENV = {
  ACCESS_CODE: "secret",
  REQUEST_WAKE_EVENT_SOURCE: "fruition.frontend",
  REQUEST_WAKE_DETAIL_TYPE: "wake-requested",
  REQUEST_WAKE_STATE_TABLE: "fruition-request-wake"
};
const unlockedCookie = `${ACCESS_COOKIE}=${await hashAccessCode("secret")}`;

// 60초 중복 방지 상태가 모듈에 남으므로 테스트마다 Date를 크게 앞당겨 이전 발행과 겹치지 않게 한다.
let clock = Date.now();

function setup(t, env = {}) {
  const merged = { ...WAKE_ENV, ...env };
  const originals = Object.fromEntries(Object.keys(merged).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clock += 10 * 60_000;
  mock.timers.enable({ apis: ["Date"], now: clock });
  fake.reset();
  const error = t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.after(() => {
    mock.timers.reset();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return { error };
}

/** 테스트가 직접 끝내는 응답. 발행이 진행 중인 동안 들어온 요청을 확인할 때 쓴다. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function request(method, cookie) {
  return new NextRequest("http://localhost/wake", { method, headers: cookie ? { cookie } : {} });
}

test("접근 코드 쿠키가 없으면 POST가 기동 이벤트를 보내지 않는다", async (t) => {
  setup(t);
  const response = await POST(request("POST"));
  assert.equal(response.status, 403);
  assert.equal(fake.sent.length, 0);
});

test("접근 코드를 통과하면 기동 이벤트 한 건을 보낸다", async (t) => {
  setup(t);
  const response = await POST(request("POST", unlockedCookie));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(fake.sent.map((command) => command.input), [
    { Entries: [{ Source: "fruition.frontend", DetailType: "wake-requested", Detail: "{}" }] }
  ]);
});

test("ACCESS_CODE가 없으면 쿠키와 무관하게 POST는 403, GET은 unknown이고 AWS를 부르지 않는다", async (t) => {
  setup(t, { ACCESS_CODE: undefined });
  assert.equal((await POST(request("POST"))).status, 403);
  assert.equal((await POST(request("POST", unlockedCookie))).status, 403);
  assert.deepEqual(await (await GET(request("GET", unlockedCookie))).json(), { phase: "unknown" });
  assert.equal(fake.sent.length, 0);
});

test("발행에 성공하면 60초 안의 반복 POST는 이벤트를 한 번만 보낸다", async (t) => {
  setup(t);
  await POST(request("POST", unlockedCookie));
  mock.timers.tick(59_000);
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 1);

  mock.timers.tick(1_000);
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 2);
});

test("동시에 들어온 POST 두 건은 이벤트를 한 건만 보낸다", async (t) => {
  setup(t);
  const response = deferred();
  fake.respond = () => response.promise;
  const pending = [POST(request("POST", unlockedCookie)), POST(request("POST", unlockedCookie))];
  response.resolve({ FailedEntryCount: 0 });
  const statuses = (await Promise.all(pending)).map((result) => result.status);

  assert.deepEqual(statuses, [204, 204]);
  assert.equal(fake.sent.length, 1);
});

test("발행이 실패하면 10초 뒤부터 다시 보낸다", async (t) => {
  setup(t);
  fake.respond = () => { throw new Error("CredentialsProviderError"); };
  assert.equal((await POST(request("POST", unlockedCookie))).status, 204);
  mock.timers.tick(9_999);
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 1);

  mock.timers.tick(1);
  fake.respond = () => ({ FailedEntryCount: 0 });
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 2);
  // 성공한 뒤에는 다시 60초 중복 방지가 걸린다.
  mock.timers.tick(10_000);
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 2);
});

test("FailedEntryCount가 0보다 크면 실패로 기록하고 10초 뒤 다시 보낸다", async (t) => {
  const { error } = setup(t);
  fake.respond = () => ({ FailedEntryCount: 1, Entries: [{ ErrorCode: "InternalFailure" }] });
  assert.equal((await POST(request("POST", unlockedCookie))).status, 204);
  assert.deepEqual(error.mock.calls.at(-1).arguments, ["[wake] 기동 이벤트 발행 실패", "InternalFailure"]);

  mock.timers.tick(10_000);
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 2);
});

test("3초 타임아웃으로 중단되면 204로 끝내고 실패로 기록한다", async (t) => {
  const { error } = setup(t);
  // AbortSignal.timeout을 직접 끊을 수 있는 신호로 바꿔 3초를 기다리지 않는다.
  const controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, "timeout", () => controller.signal);
  const signals = [];
  fake.respond = (_command, options) => new Promise((_resolve, reject) => {
    signals.push(options?.abortSignal);
    options?.abortSignal?.addEventListener("abort", () => reject(options.abortSignal.reason));
  });

  const pending = POST(request("POST", unlockedCookie));
  while (fake.sent.length === 0) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals[0], controller.signal);
  controller.abort(new DOMException("signal timed out", "TimeoutError"));

  assert.equal((await pending).status, 204);
  assert.deepEqual(timeout.mock.calls[0].arguments, [3_000]);
  assert.equal(error.mock.calls.at(-1).arguments[1].name, "TimeoutError");
  mock.timers.tick(10_000);
  fake.respond = () => ({ FailedEntryCount: 0 });
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 2);
});

test("환경변수가 없으면 이벤트 없이 204, 상태는 unknown", async (t) => {
  setup(t, { REQUEST_WAKE_EVENT_SOURCE: undefined, REQUEST_WAKE_STATE_TABLE: undefined });
  assert.equal((await POST(request("POST", unlockedCookie))).status, 204);
  const response = await GET(request("GET", unlockedCookie));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { phase: "unknown" });
  assert.equal(fake.sent.length, 0);
});

test("SDK 오류에도 POST는 204, GET은 unknown을 준다", async (t) => {
  setup(t);
  fake.respond = () => { throw new Error("AccessDenied"); };
  assert.equal((await POST(request("POST", unlockedCookie))).status, 204);
  const response = await GET(request("GET", unlockedCookie));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { phase: "unknown" });
});

test("GET은 controller 항목의 phase만 돌려준다", async (t) => {
  setup(t);
  fake.respond = () => ({ Item: { id: { S: "controller" }, phase: { S: "waking" }, updated_at: { S: "x" } } });
  const response = await GET(request("GET", unlockedCookie));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { phase: "waking" });
  assert.deepEqual(fake.sent[0].input.Key, { id: { S: "controller" } });
  assert.equal(fake.sent[0].input.TableName, "fruition-request-wake");
});

test("상태 항목이 없으면 awake, 모르는 값이면 unknown", async (t) => {
  setup(t);
  fake.respond = () => ({});
  assert.deepEqual(await (await GET(request("GET", unlockedCookie))).json(), { phase: "awake" });
  fake.respond = () => ({ Item: { phase: { S: "rebooting" } } });
  assert.deepEqual(await (await GET(request("GET", unlockedCookie))).json(), { phase: "unknown" });
});

test("접근 코드를 통과하지 않은 GET은 상태를 조회하지 않는다", async (t) => {
  setup(t);
  assert.deepEqual(await (await GET(request("GET"))).json(), { phase: "unknown" });
  assert.equal(fake.sent.length, 0);
});
