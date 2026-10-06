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
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.after(() => {
    mock.timers.reset();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
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

test("ACCESS_CODE가 없으면 게이트가 꺼진 배포라 쿠키 없이도 보낸다", async (t) => {
  setup(t, { ACCESS_CODE: undefined });
  assert.equal((await POST(request("POST"))).status, 204);
  assert.equal(fake.sent.length, 1);
});

test("60초 안의 반복 POST는 이벤트를 한 번만 보낸다", async (t) => {
  setup(t);
  await POST(request("POST", unlockedCookie));
  mock.timers.tick(59_000);
  await POST(request("POST", unlockedCookie));
  assert.equal(fake.sent.length, 1);

  mock.timers.tick(1_000);
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
