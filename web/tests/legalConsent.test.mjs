import assert from "node:assert/strict";
import test from "node:test";

const { LEGAL_TERMS_VERSION } = await import("../src/shared/config/legal.ts");
const {
  buildConsentBody,
  consentErrorMessage,
  EMPTY_CONSENT,
  isConsentComplete,
  isSignupEmailRegistered,
  isSignupTokenConsumed,
  isSignupTokenInvalid,
  needsReconsent,
  parseOAuthSignupToken
} = await import("../src/entities/user/model/consent.ts");

const withCode = (code, message = "server") => Object.assign(new Error(message), { code });

test("어떤 항목도 미리 체크돼 있지 않고, 필수 두 항목을 모두 체크해야 완료다", () => {
  assert.deepEqual(EMPTY_CONSENT, { ageConfirmed: false, termsAccepted: false, marketingOptIn: false });
  assert.equal(isConsentComplete(EMPTY_CONSENT), false);
  assert.equal(isConsentComplete({ ...EMPTY_CONSENT, ageConfirmed: true }), false);
  assert.equal(isConsentComplete({ ...EMPTY_CONSENT, termsAccepted: true }), false);
  assert.equal(isConsentComplete({ ...EMPTY_CONSENT, ageConfirmed: true, termsAccepted: true }), true);
  // 마케팅은 선택이라 완료 여부에 영향이 없다.
  assert.equal(isConsentComplete({ ageConfirmed: true, termsAccepted: true, marketingOptIn: true }), true);
});

test("동의 본문은 서버 필드명으로 만들고 약관 버전 상수를 쓴다. 필수가 빠지면 null", () => {
  assert.deepEqual(buildConsentBody({ ageConfirmed: true, termsAccepted: true, marketingOptIn: false }, LEGAL_TERMS_VERSION), {
    age_confirmed: true,
    terms_version: LEGAL_TERMS_VERSION,
    marketing_opt_in: false
  });
  assert.equal(buildConsentBody({ ageConfirmed: true, termsAccepted: true, marketingOptIn: true }, LEGAL_TERMS_VERSION).marketing_opt_in, true);
  assert.equal(buildConsentBody({ ageConfirmed: false, termsAccepted: true, marketingOptIn: true }, LEGAL_TERMS_VERSION), null);
  assert.equal(LEGAL_TERMS_VERSION, "2026-10-01");
});

test("동의 실패는 서버 error.code로 안내하고, 모르는 code는 서버 메시지, Error가 아니면 fallback", () => {
  assert.match(consentErrorMessage(withCode("CONSENT_REQUIRED"), "fb"), /만 18세 이상 확인과 현재 이용약관 동의/);
  assert.match(consentErrorMessage(withCode("INVALID_SIGNUP_TOKEN"), "fb"), /소셜 로그인부터 다시/);
  assert.equal(consentErrorMessage(withCode("OTHER", "서버 문구"), "fb"), "서버 문구");
  assert.equal(consentErrorMessage(null, "fb"), "fb");
  assert.equal(isSignupTokenInvalid(withCode("INVALID_SIGNUP_TOKEN")), true);
  assert.equal(isSignupTokenInvalid(withCode("CONSENT_REQUIRED")), false);
});

test("동의 409 EMAIL_REGISTERED는 토큰이 소비된 실패라 재시도 없이 로그인 화면으로 보낸다", () => {
  const registered = Object.assign(new Error("server"), { code: "EMAIL_REGISTERED", providers: ["local"] });
  assert.equal(isSignupEmailRegistered(registered), true);
  assert.equal(isSignupTokenConsumed(registered), true);
  assert.equal(isSignupTokenConsumed(withCode("INVALID_SIGNUP_TOKEN")), true);
  // CONSENT_REQUIRED는 토큰이 남아 동의만 고쳐 다시 보낼 수 있다.
  assert.equal(isSignupEmailRegistered(withCode("CONSENT_REQUIRED")), false);
  assert.equal(isSignupTokenConsumed(withCode("CONSENT_REQUIRED")), false);
  assert.equal(isSignupEmailRegistered(null), false);
});

test("OAuth 콜백 query에서 signup_token만 읽고, 기존 회원 로그인(code)·실패(error)는 null", () => {
  assert.equal(parseOAuthSignupToken(new URLSearchParams("signup_token=abc")), "abc");
  assert.equal(parseOAuthSignupToken(new URLSearchParams("code=xyz")), null);
  assert.equal(parseOAuthSignupToken(new URLSearchParams("error=oauth_failed")), null);
  assert.equal(parseOAuthSignupToken(new URLSearchParams("signup_token=")), null);
});

test("consent_required가 정확히 true일 때만 재동의 화면을 띄운다", () => {
  assert.equal(needsReconsent({ consent_required: true }), true);
  assert.equal(needsReconsent({ consent_required: false }), false);
  assert.equal(needsReconsent({}), false);
  assert.equal(needsReconsent(undefined), false);
  assert.equal(needsReconsent(null), false);
});
