import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const { buildPasswordChangeBody, passwordChangeFailure } = await import("../src/entities/user/model/passwordChange.ts");
const { requestPasswordChangeVerification, changePasswordWithVerification } = await import("../src/entities/user/api/account.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAuthRoutes } = await import("../mock/routes/auth.mjs");

const modalSource = readFileSync(
  new URL("../src/features/user-settings/ui/modals/PasswordChangeModal.tsx", import.meta.url),
  "utf8"
);
const withCode = (code, status = 400, extra = {}) => Object.assign(new Error("server"), { code, status, ...extra });

test("비밀번호 변경은 로그인한 계정 이메일만 읽기 전용으로 보여 주고 다른 이메일로 바꿀 수 없다", () => {
  assert.doesNotMatch(modalSource, /setEmail\(/);
  assert.match(modalSource, /id="password-change-email"[^>]*\breadOnly\b/s);
  assert.doesNotMatch(modalSource, /id="password-change-email"[^>]*onChange=/s);
});

test("비밀번호 변경은 로그인 세션 전용 계약을 쓰고 비로그인 password-reset 계약은 쓰지 않는다", () => {
  assert.match(modalSource, /requestPasswordChangeVerification\(\)/);
  assert.match(modalSource, /changePasswordWithVerification\(buildPasswordChangeBody\(\{ newPassword, verificationToken: token, mfaCode \}\)\)/);
  assert.doesNotMatch(modalSource, /requestEmailVerification|resetPasswordWithVerification|password_reset/);
});

test("비밀번호 변경 API는 본문 없이 인증번호를 요청하고, 새 비밀번호와 토큰만 보낸다", async (t) => {
  saveAccessToken("password-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ method: init?.method, path, body: init?.body ?? null, auth: init?.headers?.get?.("Authorization") });
    if (path === "/api/auth/me/password/verification") {
      return Response.json({ verification_id: "ev_1", expires_in: 300, retry_after: 60 }, { status: 202 });
    }
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(await requestPasswordChangeVerification(), { verification_id: "ev_1", expires_in: 300, retry_after: 60 });
  await changePasswordWithVerification(buildPasswordChangeBody({ newPassword: "newPassword1234", verificationToken: "vt_1", mfaCode: "" }));
  assert.deepEqual(calls, [
    { method: "POST", path: "/api/auth/me/password/verification", body: null, auth: "Bearer password-access" },
    {
      method: "PUT",
      path: "/api/auth/me/password/verified",
      body: JSON.stringify({ new_password: "newPassword1234", verification_token: "vt_1" }),
      auth: "Bearer password-access"
    }
  ]);
});

test("비밀번호 변경 본문은 MFA 코드를 입력했을 때만 mfa_code를 넣는다", () => {
  assert.deepEqual(buildPasswordChangeBody({ newPassword: "newPassword1234", verificationToken: "vt", mfaCode: " " }), {
    new_password: "newPassword1234",
    verification_token: "vt"
  });
  assert.deepEqual(buildPasswordChangeBody({ newPassword: "newPassword1234", verificationToken: "vt", mfaCode: " 123456 " }), {
    new_password: "newPassword1234",
    verification_token: "vt",
    mfa_code: "123456"
  });
});

test("비밀번호 변경의 MFA 코드 불일치(401 INVALID_MFA_CODE)는 재발급·재전송 없이 호출부에 던진다", async (t) => {
  saveAccessToken("password-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/auth/refresh") return Response.json({ access_token: "fresh" });
    return Response.json({ error: { code: "INVALID_MFA_CODE", message: "인증 코드 오류" } }, { status: 401 });
  });
  const body = buildPasswordChangeBody({ newPassword: "newPassword1234", verificationToken: "vt", mfaCode: "000000" });
  await assert.rejects(changePasswordWithVerification(body), (error) => error.code === "INVALID_MFA_CODE" && error.status === 401);
  assert.deepEqual(calls, ["PUT /api/auth/me/password/verified"]);
});

test("인증번호 요청 429는 Retry-After를 retryAfter(초)로 실어 던진다", async (t) => {
  saveAccessToken("password-access");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "VERIFICATION_RATE_LIMITED", message: "많음" } }, { status: 429, headers: { "Retry-After": "23" } }));
  await assert.rejects(requestPasswordChangeVerification(), (error) => {
    assert.equal(error.code, "VERIFICATION_RATE_LIMITED");
    assert.equal(error.retryAfter, 23);
    return true;
  });
});

test("비밀번호 변경 실패 code마다 모달이 할 일을 정한다", () => {
  const unavailable = passwordChangeFailure(withCode("PASSWORD_LOGIN_UNAVAILABLE"), "fb");
  assert.equal(unavailable.recovery, "unavailable");
  assert.match(unavailable.message, /소셜 계정으로 가입한 계정은 여기서 비밀번호를 설정할 수 없습니다/);
  assert.equal(passwordChangeFailure(withCode("INVALID_VERIFICATION_TOKEN"), "fb").recovery, "resend");
  // MFA 코드가 틀려도 토큰은 남아 있으므로 인증번호 단계로 돌아가지 않고 코드만 다시 받는다.
  assert.deepEqual(passwordChangeFailure(withCode("INVALID_MFA_CODE", 401), "fb"), {
    recovery: "mfa",
    message: "인증 코드가 올바르지 않습니다."
  });
  assert.deepEqual(passwordChangeFailure(withCode("EMAIL_SEND_FAILED", 502), "fb"), {
    recovery: "retry",
    message: "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."
  });
  // 비밀번호 정책 위반(INVALID_REQUEST) 등은 서버 메시지로 같은 단계에서 다시 시도한다.
  assert.deepEqual(passwordChangeFailure(withCode("INVALID_REQUEST"), "fb"), { recovery: "retry", message: "server" });
  assert.deepEqual(passwordChangeFailure("not an error", "fb"), { recovery: "retry", message: "fb" });
});

test("재요청 제한은 Retry-After만큼 막고, 값이 없으면 기본 60초를 쓴다", () => {
  const limited = passwordChangeFailure(withCode("VERIFICATION_RATE_LIMITED", 429, { retryAfter: 42 }), "fb");
  assert.deepEqual(limited, { recovery: "wait", message: "인증번호 요청이 너무 많습니다. 42초 후 다시 시도해 주세요.", retryAfter: 42 });
  assert.equal(passwordChangeFailure(withCode("VERIFICATION_RATE_LIMITED", 429, { retryAfter: null }), "fb").retryAfter, 60);
  assert.equal(passwordChangeFailure(withCode(undefined, 429), "fb").recovery, "wait");
});

test("mock은 password_change 토큰을 계정 이메일·목적에 묶고 소셜 전용 계정을 거절한다", async (t) => {
  const timestamp = new Date().toISOString();
  const mfa = { enabled: false, activated_at: null, secret: null, recovery_codes: [] };
  state.users.push(
    { id: "user_pw", email: "pw@example.test", password: "pw123456", display_name: null, provider: "email", created_at: timestamp, mfa },
    { id: "user_pw_social", email: "pwsocial@example.test", display_name: null, provider: "google", created_at: timestamp, mfa }
  );
  const router = createRouter(state);
  registerAuthRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const send = (method, path, body, token) => fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const codeOf = async (response) => (await response.json()).error?.code;
  const confirm = async (verificationId) =>
    (await (await send("POST", `/api/auth/email-verifications/${verificationId}/confirm`, { code: "123456" })).json()).verification_token;
  const access = issueAccessToken(state, "user_pw");

  // 공개 경로로는 password_change 코드를 받을 수 없다.
  let response = await send("POST", "/api/auth/email-verifications", { email: "pw@example.test", purpose: "password_change" });
  assert.equal(await codeOf(response), "INVALID_REQUEST");

  // 소셜 전용 계정은 요청·변경 모두 PASSWORD_LOGIN_UNAVAILABLE이다.
  const socialAccess = issueAccessToken(state, "user_pw_social");
  response = await send("POST", "/api/auth/me/password/verification", undefined, socialAccess);
  assert.equal(response.status, 400);
  assert.equal(await codeOf(response), "PASSWORD_LOGIN_UNAVAILABLE");
  response = await send("PUT", "/api/auth/me/password/verified", { new_password: "newPassword1234", verification_token: "vt" }, socialAccess);
  assert.equal(await codeOf(response), "PASSWORD_LOGIN_UNAVAILABLE");

  response = await send("POST", "/api/auth/me/password/verification", undefined, access);
  assert.equal(response.status, 202);
  const { verification_id } = await response.json();
  const token = await confirm(verification_id);

  // 쿨다운 안의 재요청은 Retry-After와 함께 429다.
  response = await send("POST", "/api/auth/me/password/verification", undefined, access);
  assert.equal(response.status, 429);
  assert.equal(await codeOf(response), "VERIFICATION_RATE_LIMITED");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);

  // password_change 토큰은 비로그인 password-reset에 쓸 수 없고, password_reset 토큰은 이 경로에 쓸 수 없다.
  response = await send("POST", "/api/auth/password-reset", { email: "pw@example.test", new_password: "newPassword1234", verification_token: token });
  assert.equal(response.status, 400);
  const resetId = (await (await send("POST", "/api/auth/email-verifications", { email: "pw@example.test", purpose: "password_reset" })).json()).verification_id;
  const resetToken = await confirm(resetId);
  response = await send("PUT", "/api/auth/me/password/verified", { new_password: "newPassword1234", verification_token: resetToken }, access);
  assert.equal(await codeOf(response), "INVALID_VERIFICATION_TOKEN");

  // 정책 위반은 토큰을 소비하지 않는다.
  response = await send("PUT", "/api/auth/me/password/verified", { new_password: "short", verification_token: token }, access);
  assert.equal(await codeOf(response), "INVALID_REQUEST");
  response = await send("PUT", "/api/auth/me/password/verified", { new_password: "newPassword1234", verification_token: token }, access);
  assert.equal(response.status, 204);
  assert.equal(state.users.find((user) => user.id === "user_pw").password, "newPassword1234");
  response = await send("PUT", "/api/auth/me/password/verified", { new_password: "otherPassword1234", verification_token: token }, access);
  assert.equal(await codeOf(response), "INVALID_VERIFICATION_TOKEN", "토큰은 한 번만 쓴다");

  // MFA를 켠 계정은 코드가 없거나 틀리면 401 INVALID_MFA_CODE이고, 토큰을 소비하지 않아 같은 토큰으로 다시 시도한다.
  const mfaUser = state.users.find((user) => user.id === "user_pw");
  mfaUser.mfa = { enabled: true, activated_at: timestamp, secret: "secret", recovery_codes: ["abcd-1234"] };
  t.after(() => { mfaUser.mfa = mfa; });
  // 재요청 쿨다운 안이므로 confirm을 마친 토큰을 직접 둔다.
  state.verificationTokens.set("vt_mfa", { email: "pw@example.test", purpose: "password_change" });
  for (const mfa_code of [undefined, "12345", "wrong-code"]) {
    response = await send("PUT", "/api/auth/me/password/verified", { new_password: "mfaPassword1234", verification_token: "vt_mfa", mfa_code }, access);
    assert.equal(response.status, 401);
    assert.equal(await codeOf(response), "INVALID_MFA_CODE");
  }
  assert.equal(mfaUser.password, "newPassword1234");
  response = await send("PUT", "/api/auth/me/password/verified", { new_password: "mfaPassword1234", verification_token: "vt_mfa", mfa_code: "123456" }, access);
  assert.equal(response.status, 204);
  assert.equal(mfaUser.password, "mfaPassword1234");
});
