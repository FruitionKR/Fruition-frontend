import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Node 테스트에서도 앱의 TypeScript 경로 별칭을 같은 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { LEGAL_TERMS_VERSION } = await import("../src/shared/config/legal.ts");
const { buildSignupConsentFields, EMPTY_CONSENT } = await import("../src/entities/user/model/consent.ts");
const { completeOAuthSignup, signupWithEmail } = await import("../src/entities/user/api/auth.ts");

const CONSENT_KEYS = ["age_confirmed", "terms_version", "marketing_opt_in"];
const AGREED = { ageConfirmed: true, termsAccepted: true, marketingOptIn: false };

function captureBodies(t, responseBody) {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    bodies.push({ path, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return bodies;
}

test("플래그 꺼짐: 이메일 가입 요청에 동의·나이·약관 필드를 보내지 않는다", async (t) => {
  const bodies = captureBodies(t, { ok: true });
  // 초안에 무엇이 남아 있든(동의 화면을 보지 않은 사용자) 동의 값을 만들지 않는다.
  await signupWithEmail("a@b.c", "pw", "nick", "vt-1", buildSignupConsentFields(false, AGREED, LEGAL_TERMS_VERSION));
  assert.equal(bodies[0].path, "/api/auth/signup");
  assert.deepEqual(bodies[0].body, { email: "a@b.c", password: "pw", display_name: "nick", verification_token: "vt-1" });
  for (const key of CONSENT_KEYS) assert.equal(key in bodies[0].body, false);
});

test("플래그 꺼짐: 소셜 가입 확정은 같은 엔드포인트에 signup_token만 보낸다", async (t) => {
  const bodies = captureBodies(t, { access_token: "at", mfa_required: false, consent_required: false });
  await completeOAuthSignup("signup-1", buildSignupConsentFields(false, EMPTY_CONSENT, LEGAL_TERMS_VERSION));
  assert.equal(bodies[0].path, "/api/auth/oauth/signup/consent");
  assert.deepEqual(bodies[0].body, { signup_token: "signup-1" });
});

test("플래그 켜짐: 두 가입 요청 모두 지금처럼 사용자 동의를 서버 필드명으로 보낸다", async (t) => {
  const bodies = captureBodies(t, { access_token: "at", mfa_required: false });
  const consent = buildSignupConsentFields(true, AGREED, LEGAL_TERMS_VERSION);
  await signupWithEmail("a@b.c", "pw", "nick", "vt-1", consent);
  await completeOAuthSignup("signup-1", consent);
  const expected = { age_confirmed: true, terms_version: LEGAL_TERMS_VERSION, marketing_opt_in: false };
  assert.deepEqual(bodies[0].body, { email: "a@b.c", password: "pw", display_name: "nick", verification_token: "vt-1", ...expected });
  assert.deepEqual(bodies[1].body, { signup_token: "signup-1", ...expected });
});
