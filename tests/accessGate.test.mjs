import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// next/server는 package exports가 없어 Node ESM에서 확장자까지 적어야 해석된다.
// 앱 소스의 확장자 없는 상대 import는 .ts로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { NextRequest } = await import("next/server");

const { handleAccessGate } = await import("../src/shared/lib/accessGate.ts");
const { ACCESS_COOKIE, hashAccessCode, isSameAccessToken } = await import("../src/shared/lib/accessCode.ts");

function withAccessCode(t, code) {
  const original = process.env.ACCESS_CODE;
  if (code === undefined) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = code;
  t.after(() => {
    if (original === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = original;
  });
}

function request(path, cookie) {
  return new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
}

test("ACCESS_CODE가 없으면 게이트를 통과시킨다", async (t) => {
  withAccessCode(t, undefined);
  const response = await handleAccessGate(request("/api/workspaces/ws/documents"));
  assert.equal(response.status, 200);
});

test("접근 코드 쿠키가 없으면 보호된 API를 403으로 막는다", async (t) => {
  withAccessCode(t, "secret");
  const response = await handleAccessGate(request("/api/workspaces/ws/documents"));
  assert.equal(response.status, 403);
});

test("로그인·워크스페이스 선택 경로는 접근 코드 없이 열어 둔다", async (t) => {
  withAccessCode(t, "secret");
  for (const path of ["/api/auth/login", "/api/invitations/abc", "/api/workspaces", "/api/workspaces/ws"]) {
    assert.equal((await handleAccessGate(request(path))).status, 200, path);
  }
});

test("올바른 접근 코드 쿠키가 있으면 통과시킨다", async (t) => {
  withAccessCode(t, "secret");
  const cookie = `${ACCESS_COOKIE}=${await hashAccessCode("secret")}`;
  assert.equal((await handleAccessGate(request("/api/workspaces/ws/documents", cookie))).status, 200);
});

test("접근 쿠키 비교는 같은 값만 통과시키고 길이·접두사가 달라도 끝까지 비교한다", async () => {
  const expected = await hashAccessCode("secret");
  assert.equal(isSameAccessToken(expected, expected), true);
  assert.equal(isSameAccessToken(undefined, expected), false);
  assert.equal(isSameAccessToken("", expected), false);
  assert.equal(isSameAccessToken(expected.slice(0, -1), expected), false);
  assert.equal(isSameAccessToken(`${expected}0`, expected), false);
  assert.equal(isSameAccessToken(`${expected.slice(0, -1)}${expected.endsWith("0") ? "1" : "0"}`, expected), false);
});

test("올바르지 않은 접근 코드 쿠키는 403으로 막는다", async (t) => {
  withAccessCode(t, "secret");
  const cookie = `${ACCESS_COOKIE}=${await hashAccessCode("other")}`;
  assert.equal((await handleAccessGate(request("/api/workspaces/ws/documents", cookie))).status, 403);
});
