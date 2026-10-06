import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { mock } from "node:test";

// next/server는 확장자까지 적어야 해석된다. @/ 별칭은 src/로, 앱 소스의 확장자 없는 상대 import는 .ts로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    const fromAppSource = /\/(app|src)\//.test(context.parentURL ?? "") && !context.parentURL.includes("/node_modules/");
    if (fromAppSource && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const { NextRequest } = await import("next/server");
const { POST } = await import("../app/access/verify/route.ts");
const limiter = await import("../app/access/verify/attemptLimiter.ts");

// 실패 기록이 모듈에 남으므로 테스트마다 다른 클라이언트 IP를 쓰고, Date를 크게 앞당겨 이전 기록과 겹치지 않게 한다.
let clock = Date.now();
let clientSeq = 0;

function setup(t, accessCode = "secret") {
  const original = process.env.ACCESS_CODE;
  if (accessCode === null) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = accessCode;
  clock += 60 * 60_000;
  mock.timers.enable({ apis: ["Date"], now: clock });
  t.after(() => {
    mock.timers.reset();
    if (original === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = original;
  });
  clientSeq += 1;
  return `10.0.0.${clientSeq}`;
}

function verify(code, forwardedFor) {
  return POST(new NextRequest("http://localhost/access/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) },
    body: JSON.stringify({ code })
  }));
}

async function failTimes(count, forwardedFor) {
  for (let i = 0; i < count; i += 1) assert.equal((await verify("wrong", forwardedFor)).status, 401);
}

test("코드가 맞으면 쿠키를 심고, 틀리면 401", async (t) => {
  const ip = setup(t);
  const ok = await verify(" secret ", ip);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie") ?? "", /fruition_access=/);
  assert.equal((await verify("secreT", ip)).status, 401);
  assert.equal((await verify("", ip)).status, 401);
});

test("10번 실패하면 같은 클라이언트는 맞는 코드도 429로 막는다", async (t) => {
  const ip = setup(t);
  await failTimes(10, ip);
  const blocked = await verify("secret", ip);

  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "600");
  assert.deepEqual(await blocked.json(), { message: "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요." });
  // 다른 클라이언트는 영향을 받지 않는다.
  assert.equal((await verify("secret", `${ip}9`)).status, 200);
});

test("차단은 첫 실패로부터 10분이 지나면 풀린다", async (t) => {
  const ip = setup(t);
  await failTimes(10, ip);
  mock.timers.tick(10 * 60_000 - 1);
  assert.equal((await verify("secret", ip)).status, 429);
  mock.timers.tick(1);
  assert.equal((await verify("secret", ip)).status, 200);
});

test("성공하면 실패 횟수를 초기화한다", async (t) => {
  const ip = setup(t);
  await failTimes(9, ip);
  assert.equal((await verify("secret", ip)).status, 200);
  await failTimes(9, ip);
  assert.equal((await verify("secret", ip)).status, 200);
});

test("x-forwarded-for는 ALB가 덧붙인 마지막 hop으로 센다(앞쪽 hop 위조로 우회할 수 없다)", async (t) => {
  const ip = setup(t);
  for (let i = 0; i < 10; i += 1) assert.equal((await verify("wrong", `198.51.100.${i}, ${ip}`)).status, 401);
  assert.equal((await verify("secret", `203.0.113.1, ${ip}`)).status, 429);
  assert.equal(limiter.getClientKey(null), "unknown");
  assert.equal(limiter.getClientKey(" 1.1.1.1 , 2.2.2.2 "), "2.2.2.2");
});

test("ACCESS_CODE가 없으면 시도 제한 없이 ok를 준다", async (t) => {
  const ip = setup(t, null);
  for (let i = 0; i < 12; i += 1) assert.equal((await verify("anything", ip)).status, 200);
});

test("추적하는 클라이언트 수가 상한에 닿으면 가장 오래된 기록부터 지운다", (t) => {
  setup(t);
  const now = Date.now();
  for (let i = 0; i < limiter.MAX_FAILURES; i += 1) limiter.recordFailure("oldest", now);
  assert.ok(limiter.getBlockedMs("oldest", now) > 0);

  for (let i = 0; i < limiter.MAX_TRACKED_CLIENTS; i += 1) limiter.recordFailure(`client-${i}`, now);
  assert.equal(limiter.getBlockedMs("oldest", now), 0);
});
