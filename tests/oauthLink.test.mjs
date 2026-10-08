import assert from "node:assert/strict";
import test from "node:test";

const {
  oauthAccountErrorMessage,
  parseOAuthLinkCallback,
  saveOAuthLinkResult,
  hasOAuthLinkResult,
  signupOAuthHint,
  takeOAuthLinkResult
} = await import("../src/entities/user/model/oauthLink.ts");

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key)
  };
}

test("연동 콜백 query에서 link_code와 link=failed를 구분하고, 로그인 콜백은 건드리지 않는다", () => {
  assert.deepEqual(parseOAuthLinkCallback(new URLSearchParams("link_code=abc")), { kind: "confirm", linkCode: "abc" });
  assert.deepEqual(parseOAuthLinkCallback(new URLSearchParams("link=failed")), { kind: "failed" });
  assert.equal(parseOAuthLinkCallback(new URLSearchParams("code=xyz")), null);
  assert.equal(parseOAuthLinkCallback(new URLSearchParams("error=oauth_failed")), null);
  assert.equal(parseOAuthLinkCallback(new URLSearchParams("link_code=")), null);
});

test("연동·해제 실패는 서버 error.code로 안내하고, 모르는 code는 서버 메시지를 쓴다", () => {
  const withCode = (code, message = "server") => Object.assign(new Error(message), { code });
  assert.match(oauthAccountErrorMessage(withCode("OAUTH_ACCOUNT_ALREADY_LINKED"), "fb"), /이미 다른 계정에 연결된/);
  assert.match(oauthAccountErrorMessage(withCode("INVALID_OAUTH_LINK_CODE"), "fb"), /만료/);
  assert.match(oauthAccountErrorMessage(withCode("OAUTH_UNLINK_NOT_ALLOWED"), "fb"), /가입할 때 사용한/);
  assert.match(oauthAccountErrorMessage(withCode("OAUTH_ACCOUNT_NOT_FOUND"), "fb"), /연결되지 않은/);
  assert.match(oauthAccountErrorMessage(withCode("UNSUPPORTED_OAUTH_PROVIDER"), "fb"), /지원하지 않는/);
  assert.equal(oauthAccountErrorMessage(withCode("SOMETHING_ELSE", "서버 문구"), "fb"), "서버 문구");
  assert.equal(oauthAccountErrorMessage("not an error", "fb"), "fb");
});

test("소셜 가입 이메일이면 provider 이름으로 기존 계정 연동을 안내하고, 없으면 안내하지 않는다", () => {
  assert.equal(signupOAuthHint([]), null);
  assert.match(signupOAuthHint(["google"]), /^이 이메일은 Google로 가입된 계정이 있습니다\. 기존 계정으로 로그인한 뒤 설정에서 연동하세요\./);
  assert.match(signupOAuthHint(["google", "kakao"]), /Google, 카카오로 가입된/);
});

test("연동 결과는 한 번만 읽히고, 형식이 틀린 값은 버린다", () => {
  const storage = memoryStorage();
  assert.equal(hasOAuthLinkResult(storage), false);
  saveOAuthLinkResult({ ok: true, message: "done" }, storage);
  assert.equal(hasOAuthLinkResult(storage), true);
  assert.deepEqual(takeOAuthLinkResult(storage), { ok: true, message: "done" });
  assert.equal(takeOAuthLinkResult(storage), null);

  storage.setItem("fruition.oauth_link_result", "{broken");
  assert.equal(takeOAuthLinkResult(storage), null);
  assert.equal(hasOAuthLinkResult(storage), false);
});
