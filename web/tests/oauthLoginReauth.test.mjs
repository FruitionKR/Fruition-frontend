import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createResolver, render } from "./asyncHookShim.mjs";

// 소셜 계정 탈퇴의 본인 확인(#253). 서버는 직접 로그인으로 받은 access token의 auth_time만 최근 인증으로 본다.
// refresh로 받은 토큰에는 auth_time이 없어, 그 토큰이 직접 로그인 토큰을 덮어쓰면 재로그인 안내가 반복된다.
registerHooks({ resolve: createResolver() });

const { apiFetch } = await import("../src/shared/api/client.ts");
const { clearAuth, getAccessToken, saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { useOAuthCallbackGate } = await import("../src/views/auth/model/useOAuthCallbackGate.ts");

const DIRECT_TOKEN = "direct-login-token";
const REFRESHED_TOKEN = "refreshed-token";

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function browserWindow(t) {
  const original = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  });
  t.after(() => {
    clearAuth();
    globalThis.window = original;
  });
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** 로그인 화면이 콜백 query를 지우는 것처럼, 같은 훅을 다른 query로 다시 렌더한다. */
function renderGate(query) {
  let params = new URLSearchParams(query);
  const view = render(() => useOAuthCallbackGate(params));
  return {
    view,
    clearQuery() {
      params = new URLSearchParams("");
      view.rerender();
    }
  };
}

test("OAuth 콜백 query를 지운 뒤에도 세션 자동 조회가 로그인 처리를 가로채지 않는다", () => {
  for (const provider of ["kakao", "naver", "google"]) {
    // 공통 콜백 /login?code=...는 provider와 무관하다. provider는 서버가 code 안에 담는다.
    const { view, clearQuery } = renderGate(`code=${provider}-code`);
    assert.equal(view.result.canCheckSession, false, `${provider}: 콜백 첫 렌더`);

    clearQuery();
    // query만 보면 콜백이 아닌 화면이지만, code 교환이 끝나기 전에는 /me·refresh를 시작하지 않는다.
    assert.equal(view.result.hasOAuthParams, false);
    assert.equal(view.result.canCheckSession, false, `${provider}: query 제거 뒤`);
  }
});

test("code 교환이 MFA 요구나 실패로 끝나면 세션 자동 조회를 다시 허용한다", () => {
  const { view, clearQuery } = renderGate("code=abc");
  clearQuery();
  view.result.finishOAuthLoginAttempt();
  view.rerender();
  assert.equal(view.result.canCheckSession, true);
});

test("콜백이 아닌 로그인 화면은 처음부터 남은 세션으로 자동 복귀를 확인한다", () => {
  const { view } = renderGate("");
  assert.equal(view.result.canCheckSession, true);
  assert.equal(view.result.isOAuthLinkCallback, false);
});

test("소셜 연동·가입 동의·오류 콜백은 기존처럼 query가 있는 동안 세션 조회를 막고, 연동은 지운 뒤에도 막는다", () => {
  const link = renderGate("link_code=abc");
  assert.equal(link.view.result.isOAuthLinkCallback, true);
  link.clearQuery();
  assert.equal(link.view.result.canCheckSession, false);

  assert.equal(renderGate("signup_token=tok").view.result.canCheckSession, false);
  // 오류 콜백은 교환할 code가 없으므로 지운 뒤에는 남은 세션 확인을 막지 않는다(기존 동작).
  const failed = renderGate("error=oauth_failed");
  assert.equal(failed.view.result.canCheckSession, false);
  failed.clearQuery();
  assert.equal(failed.view.result.canCheckSession, true);
});

test("진행 중이던 refresh가 늦게 끝나도 그 사이 직접 로그인으로 받은 토큰을 덮어쓰지 않는다", async (t) => {
  browserWindow(t);
  clearAuth();
  const refresh = deferred();
  const meCalls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/auth/refresh") {
      await refresh.promise;
      return Response.json({ access_token: REFRESHED_TOKEN });
    }
    const authorization = new Headers(init?.headers).get("Authorization");
    meCalls.push(authorization);
    if (!authorization) return new Response(null, { status: 401 });
    return Response.json({ id: "user_1" });
  });

  // 토큰 없이 시작한 세션 조회가 401을 받고 refresh를 기다리는 동안,
  const me = apiFetch("/api/auth/me");
  await flush();
  // OAuth code 교환이 끝나 직접 로그인 토큰(auth_time 있음)을 저장한다.
  saveAccessToken(DIRECT_TOKEN);
  refresh.resolve();
  const response = await me;

  assert.equal(response.status, 200);
  assert.equal(getAccessToken(), DIRECT_TOKEN);
  // 재시도도 덮어쓰지 않은 직접 로그인 토큰으로 보낸다.
  assert.deepEqual(meCalls, [null, `Bearer ${DIRECT_TOKEN}`]);
});

test("그 사이 다른 로그인이 없으면 refresh로 받은 토큰을 저장한다", async (t) => {
  browserWindow(t);
  clearAuth();
  t.mock.method(globalThis, "fetch", async (path, init) => {
    if (path === "/api/auth/refresh") return Response.json({ access_token: REFRESHED_TOKEN });
    if (!new Headers(init?.headers).get("Authorization")) return new Response(null, { status: 401 });
    return Response.json({ id: "user_1" });
  });

  const response = await apiFetch("/api/auth/me");
  assert.equal(response.status, 200);
  assert.equal(getAccessToken(), REFRESHED_TOKEN);
});
