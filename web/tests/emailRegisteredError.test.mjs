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

const { ApiError, EmailRegisteredError } = await import("../src/shared/lib/apiErrors.ts");
const { checkEmailAvailability, requestEmailVerification, signupWithEmail } = await import("../src/entities/user/api/emailVerification.ts");
const { verificationWaitMessage, verificationWaitSeconds } = await import("../src/entities/user/model/verificationWait.ts");
const { completeOAuthSignup } = await import("../src/entities/user/api/consent.ts");

const consent = { age_confirmed: true, terms_version: "2026-10-01", marketing_opt_in: false };

test("인증번호 요청 409 EMAIL_REGISTERED_WITH_OAUTH는 oauth_providers를 가진 EmailRegisteredError로 온다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { code: "EMAIL_REGISTERED_WITH_OAUTH", message: "서버 문구" }, oauth_providers: ["google", "kakao"] },
    { status: 409 }
  ));
  const error = await requestEmailVerification("user@example.com", "signup").catch((cause) => cause);
  assert.ok(error instanceof EmailRegisteredError);
  assert.equal(error.status, 409);
  assert.equal(error.code, "EMAIL_REGISTERED_WITH_OAUTH");
  assert.deepEqual(error.providers, ["google", "kakao"]);
  assert.equal(error.message, "서버 문구");
});

test("회원가입 409 EMAIL_REGISTERED_WITH_OAUTH도 같은 에러이고, DUPLICATE_EMAIL은 그대로 ApiError다", async (t) => {
  const bodies = [
    { error: { code: "EMAIL_REGISTERED_WITH_OAUTH", message: "소셜" }, oauth_providers: ["naver"] },
    { error: { code: "DUPLICATE_EMAIL", message: "이미 가입된 이메일입니다." } }
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json(bodies.shift(), { status: 409 }));
  const registered = await signupWithEmail("user@example.com", "pw", "name", "vt", consent).catch((cause) => cause);
  assert.ok(registered instanceof EmailRegisteredError);
  assert.deepEqual(registered.providers, ["naver"]);

  const duplicate = await signupWithEmail("user@example.com", "pw", "name", "vt", consent).catch((cause) => cause);
  assert.ok(duplicate instanceof ApiError);
  assert.ok(!(duplicate instanceof EmailRegisteredError));
  assert.equal(duplicate.code, "DUPLICATE_EMAIL");
  assert.equal(duplicate.message, "이미 가입된 이메일입니다.");
});

test("소셜 가입 동의 409 EMAIL_REGISTERED는 providers를 가진 EmailRegisteredError로 오고, 문자열이 아닌 항목은 버린다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { code: "EMAIL_REGISTERED", message: "서버 문구" }, providers: ["local", 1, null, "google"] },
    { status: 409 }
  ));
  const error = await completeOAuthSignup("signup-token", consent).catch((cause) => cause);
  assert.ok(error instanceof EmailRegisteredError);
  assert.equal(error.code, "EMAIL_REGISTERED");
  assert.deepEqual(error.providers, ["local", "google"]);
});

test("인증번호 요청 429는 Retry-After를 retryAfter로 실어 던지고 대기 문구로 바뀐다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { code: "VERIFICATION_RATE_LIMITED", message: "인증 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." } },
    { status: 429, headers: { "Retry-After": "48" } }
  ));
  const error = await requestEmailVerification("user@example.com", "signup").catch((cause) => cause);
  assert.equal(error.status, 429);
  assert.equal(error.retryAfter, 48);
  assert.equal(verificationWaitSeconds(error), 48);
  assert.equal(verificationWaitMessage(48), "인증 요청이 너무 잦아요. 48초 후 다시 시도해 주세요.");
});

test("Retry-After가 없는 429는 기본 대기 시간으로 안내한다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "VERIFICATION_RATE_LIMITED", message: "서버 문구" } }, { status: 429 }));
  const error = await requestEmailVerification("user@example.com", "signup").catch((cause) => cause);
  assert.equal(verificationWaitSeconds(error), 60);
});

test("이메일 중복 확인의 429도 대기 시간을 알 수 있다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "EMAIL_AVAILABILITY_RATE_LIMITED", message: "서버 문구" } }, { status: 429, headers: { "Retry-After": "120" } }));
  const error = await checkEmailAvailability("user@example.com").catch((cause) => cause);
  assert.equal(verificationWaitSeconds(error), 120);
});

test("429가 아닌 실패는 대기로 다루지 않는다", () => {
  assert.equal(verificationWaitSeconds(new ApiError("서버 문구", 500)), null);
  assert.equal(verificationWaitSeconds(new Error("네트워크")), null);
  assert.equal(verificationWaitSeconds(null), null);
});

test("하루 한도처럼 긴 대기는 알아보기 쉬운 단위로 적는다", () => {
  assert.equal(verificationWaitMessage(60), "인증 요청이 너무 잦아요. 1분 후 다시 시도해 주세요.");
  assert.equal(verificationWaitMessage(95), "인증 요청이 너무 잦아요. 2분 후 다시 시도해 주세요.");
  assert.equal(verificationWaitMessage(7200), "인증 요청이 너무 잦아요. 2시간 후 다시 시도해 주세요.");
  assert.equal(verificationWaitMessage(7260), "인증 요청이 너무 잦아요. 2시간 1분 후 다시 시도해 주세요.");
});
