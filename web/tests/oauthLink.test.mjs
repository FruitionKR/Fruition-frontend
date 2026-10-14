import assert from "node:assert/strict";
import test from "node:test";

const {
  oauthAccountErrorMessage,
  oauthCallbackErrorMessage,
  parseOAuthCallbackError,
  parseOAuthLinkCallback,
  registeredEmailErrorMessage,
  registeredEmailLoginMessage,
  saveOAuthLinkResult,
  hasOAuthLinkResult,
  signupAvailabilityMessage,
  signupOAuthConflictMessage,
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

test("소셜 가입 이메일이면 가입을 막고 그 소셜 로그인 뒤 설정에서 연동하도록 안내하며, 없으면 막지 않는다", () => {
  assert.equal(signupOAuthConflictMessage([]), null);
  assert.equal(signupOAuthConflictMessage(["google"]), "이미 Google로 가입된 이메일입니다. Google로 로그인한 뒤 설정 > 계정 보안에서 연동해 주세요.");
  assert.match(signupOAuthConflictMessage(["google", "kakao"]), /^이미 Google, 카카오로 가입된/);
});

test("가입 화면 분기: oauth_providers가 있으면 available과 무관하게 소셜 로그인 안내가 먼저, 다음이 이메일 중복, 가입 가능이면 null", () => {
  assert.match(signupAvailabilityMessage({ available: false, oauth_providers: ["kakao"] }), /^이미 카카오로 가입된 이메일입니다\. 카카오로 로그인한 뒤/);
  // 예전 서버처럼 소셜 가입 이메일을 available=true로 돌려줘도 소셜 안내를 탄다.
  assert.match(signupAvailabilityMessage({ available: true, oauth_providers: ["naver"] }), /네이버로 로그인한 뒤/);
  assert.equal(signupAvailabilityMessage({ available: false, oauth_providers: [] }), "이미 가입된 이메일입니다.");
  assert.equal(signupAvailabilityMessage({ available: false }), "이미 가입된 이메일입니다.");
  assert.equal(signupAvailabilityMessage({ available: true, oauth_providers: [] }), null);
  assert.equal(signupAvailabilityMessage({ available: true }), null);
});

test("같은 이메일의 계정 안내: local이 있으면 이메일 로그인, 아니면 그 소셜 로그인 뒤 설정 > 계정 보안에서 연동", () => {
  assert.equal(registeredEmailLoginMessage([]), null);
  assert.equal(registeredEmailLoginMessage(["local"]), "이미 이메일로 가입된 이메일입니다. 이메일과 비밀번호로 로그인한 뒤 설정 > 계정 보안에서 연동해 주세요.");
  assert.match(registeredEmailLoginMessage(["local", "google"]), /^이미 이메일로 가입된 이메일입니다\. 이메일과 비밀번호로 로그인한 뒤/);
  assert.equal(registeredEmailLoginMessage(["google"]), "이미 Google로 가입된 이메일입니다. Google로 로그인한 뒤 설정 > 계정 보안에서 연동해 주세요.");
});

test("409 EMAIL_REGISTERED_WITH_OAUTH·EMAIL_REGISTERED만 providers로 안내하고, 다른 오류는 null", () => {
  const withCode = (code, providers) => Object.assign(new Error("server"), { code, providers });
  assert.match(registeredEmailErrorMessage(withCode("EMAIL_REGISTERED_WITH_OAUTH", ["google"])), /Google로 로그인한 뒤/);
  assert.match(registeredEmailErrorMessage(withCode("EMAIL_REGISTERED", ["local", "kakao"])), /이메일과 비밀번호로 로그인한 뒤/);
  // providers가 비어 와도 두 번째 가입 대신 로그인·연동을 안내한다.
  assert.match(registeredEmailErrorMessage(withCode("EMAIL_REGISTERED", [])), /^이미 가입된 이메일입니다\. 기존 방법으로 로그인한 뒤/);
  assert.equal(registeredEmailErrorMessage(withCode("DUPLICATE_EMAIL", undefined)), null);
  assert.equal(registeredEmailErrorMessage(new Error("plain")), null);
  assert.equal(registeredEmailErrorMessage(null), null);
});

test("OAuth 콜백 파라미터: error=email_registered는 providers(쉼표 구분)를 읽고, 다른 error는 failed, error가 없으면 null", () => {
  assert.deepEqual(parseOAuthCallbackError(new URLSearchParams("error=email_registered&providers=local,google")), { kind: "email_registered", providers: ["local", "google"] });
  assert.deepEqual(parseOAuthCallbackError(new URLSearchParams("error=email_registered&providers=kakao")), { kind: "email_registered", providers: ["kakao"] });
  assert.deepEqual(parseOAuthCallbackError(new URLSearchParams("error=email_registered&providers=")), { kind: "email_registered", providers: [] });
  assert.deepEqual(parseOAuthCallbackError(new URLSearchParams("error=email_registered")), { kind: "email_registered", providers: [] });
  assert.deepEqual(parseOAuthCallbackError(new URLSearchParams("error=oauth_failed")), { kind: "failed" });
  assert.equal(parseOAuthCallbackError(new URLSearchParams("code=xyz")), null);
  assert.equal(parseOAuthCallbackError(new URLSearchParams("signup_token=abc")), null);
  assert.equal(parseOAuthCallbackError(new URLSearchParams("link=failed")), null);

  assert.match(oauthCallbackErrorMessage({ kind: "email_registered", providers: ["local", "google"] }), /이메일과 비밀번호로 로그인한 뒤/);
  assert.match(oauthCallbackErrorMessage({ kind: "email_registered", providers: ["google"] }), /Google로 로그인한 뒤/);
  assert.match(oauthCallbackErrorMessage({ kind: "email_registered", providers: [] }), /기존 방법으로 로그인한 뒤/);
  assert.equal(oauthCallbackErrorMessage({ kind: "failed" }), "간편 로그인에 실패했습니다.");
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
