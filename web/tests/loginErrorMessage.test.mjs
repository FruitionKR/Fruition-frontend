import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const {
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_NETWORK_ERROR_MESSAGE,
  LOGIN_SERVER_ERROR_MESSAGE,
  SERVER_PREPARING_MESSAGE,
  TOO_MANY_LOGIN_ATTEMPTS_MESSAGE,
  getLoginErrorMessage
} = await import("../src/views/auth/lib/loginErrorMessage.ts");

test("서버가 준비 중이면 원인과 관계없이 준비 중 문구를 쓴다", () => {
  assert.equal(getLoginErrorMessage(new ApiError("x", 401), true), SERVER_PREPARING_MESSAGE);
  assert.equal(getLoginErrorMessage(new TypeError("fetch failed"), true), SERVER_PREPARING_MESSAGE);
});

test("400·401만 자격 증명 오류로 안내한다", () => {
  assert.equal(getLoginErrorMessage(new ApiError("Unauthorized", 401), false), INVALID_CREDENTIALS_MESSAGE);
  assert.equal(getLoginErrorMessage(new ApiError("Bad Request", 400), false), INVALID_CREDENTIALS_MESSAGE);
});

test("시도 제한·서버 오류·네트워크 단절은 비밀번호 오류로 안내하지 않는다", () => {
  assert.equal(getLoginErrorMessage(new ApiError("Too Many Requests", 429), false), TOO_MANY_LOGIN_ATTEMPTS_MESSAGE);
  assert.equal(getLoginErrorMessage(new ApiError("Internal", 500), false), LOGIN_SERVER_ERROR_MESSAGE);
  assert.equal(getLoginErrorMessage(new ApiError("Bad Gateway", 502), false), LOGIN_SERVER_ERROR_MESSAGE);
  assert.equal(getLoginErrorMessage(new TypeError("fetch failed"), false), LOGIN_NETWORK_ERROR_MESSAGE);
  assert.equal(getLoginErrorMessage(null, false), LOGIN_NETWORK_ERROR_MESSAGE);
});

test("그 밖의 HTTP 실패는 서버가 준 문구를 그대로 보여 준다", () => {
  assert.equal(getLoginErrorMessage(new ApiError("접근 코드가 필요합니다.", 403), false), "접근 코드가 필요합니다.");
});

test("스크립트가 붙기 전에는 제출을 막고, 그동안 입력한 값을 상태로 옮긴다", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  assert.match(await read("shared/ui/auth/AuthControls.tsx"), /disabled=\{disabled \|\| !isHydrated\}/);
  const login = await read("views/auth/ui/LoginPage.tsx");
  assert.match(login, /new FormData\(form\)/);
  assert.match(login, /method="post"/, "제출이 새더라도 비밀번호가 URL에 나가지 않게 POST를 유지한다");
});
