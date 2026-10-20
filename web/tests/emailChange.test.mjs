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

const { buildEmailChangeBody, emailChangeFailure, emailCodeRequestFailureMessage, parseRetryAfterSeconds } = await import("../src/entities/user/model/emailChange.ts");
const { changeEmail } = await import("../src/entities/user/api/account.ts");
const { saveAccessToken, setSessionExpiredHandler } = await import("../src/shared/lib/authSessionStorage.ts");
const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAuthRoutes } = await import("../mock/routes/auth.mjs");

const withCode = (code, status = 401, extra = {}) => Object.assign(new Error("server"), { code, status, ...extra });

test("이메일 변경 본문은 비밀번호·MFA 코드를 입력했을 때만 넣는다", () => {
  assert.deepEqual(buildEmailChangeBody({ newEmail: " new@example.test ", verificationToken: "vt", password: "", mfaCode: " " }), {
    new_email: "new@example.test",
    verification_token: "vt"
  });
  assert.deepEqual(buildEmailChangeBody({ newEmail: "new@example.test", verificationToken: "vt", password: " pw ", mfaCode: " 123456 " }), {
    new_email: "new@example.test",
    verification_token: "vt",
    current_password: " pw ",
    mfa_code: "123456"
  });
});

test("이메일 변경 실패 code마다 모달이 다시 받을 입력을 정한다", () => {
  const recoveryOf = (error) => emailChangeFailure(error, "fb").recovery;
  assert.equal(recoveryOf(withCode("INVALID_REQUEST", 400)), "email");
  assert.equal(recoveryOf(withCode("DUPLICATE_EMAIL", 409)), "email");
  assert.equal(recoveryOf(withCode("INVALID_VERIFICATION_TOKEN", 400)), "code");
  assert.equal(recoveryOf(withCode("INVALID_CREDENTIALS")), "password");
  assert.equal(recoveryOf(withCode("INVALID_MFA_CODE")), "mfa");
  assert.equal(recoveryOf(withCode("REAUTHENTICATION_REQUIRED")), "relogin");
  assert.match(emailChangeFailure(withCode("REAUTHENTICATION_REQUIRED"), "fb").message, /다시 로그인한 뒤 10분 안에/);
  assert.deepEqual(emailChangeFailure(withCode("UNKNOWN"), "fb"), { recovery: "retry", message: "server" });
  assert.deepEqual(emailChangeFailure("not an error", "fb"), { recovery: "retry", message: "fb" });
});

test("429는 Retry-After만큼 제출을 막고, 값이 없으면 기본 60초를 쓴다", () => {
  const limited = emailChangeFailure(withCode("PASSWORD_CHANGE_RATE_LIMITED", 429, { retryAfter: 42 }), "fb");
  assert.equal(limited.recovery, "wait");
  assert.equal(limited.retryAfter, 42);
  assert.match(limited.message, /비밀번호 확인 시도가 너무 많습니다\. 42초 후/);
  assert.match(emailChangeFailure(withCode("MFA_RATE_LIMITED", 429, { retryAfter: null }), "fb").message, /인증 코드 확인.*60초 후/);
  assert.equal(emailChangeFailure(withCode(undefined, 429), "fb").recovery, "wait");

  assert.equal(parseRetryAfterSeconds("120"), 120);
  assert.equal(parseRetryAfterSeconds(new Date(10_000 + 30_000).toUTCString(), 10_000), 30);
  assert.equal(parseRetryAfterSeconds(null), null);
  assert.equal(parseRetryAfterSeconds("soon"), null);
});

test("이메일 변경의 본인 확인 실패(401 + code)는 refresh·재전송 없이 올리고, code 없는 401만 재발급한다", async (t) => {
  saveAccessToken("email-access");
  t.after(() => setSessionExpiredHandler(null));
  let notified = 0;
  setSessionExpiredHandler(() => { notified++; });
  const body = { new_email: "new@example.test", verification_token: "vt", current_password: "pw" };
  // 같은 메서드를 여러 번 mock하면 복원이 꼬이므로 한 번만 mock하고 응답만 바꾼다.
  let calls = [];
  let code = null;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/auth/refresh") return Response.json({ access_token: "fresh" });
    if (code) return Response.json({ error: { code, message: "확인 실패" } }, { status: 401 });
    if (calls.length === 1) return new Response(null, { status: 401 });
    assert.equal(init.headers.get("Authorization"), "Bearer fresh");
    return Response.json({ id: "user_test", email: "new@example.test" });
  });
  for (const rejected of ["INVALID_CREDENTIALS", "INVALID_MFA_CODE", "REAUTHENTICATION_REQUIRED"]) {
    calls = [];
    code = rejected;
    await assert.rejects(changeEmail(body), (error) => error.code === rejected && error.status === 401);
    assert.deepEqual(calls, ["PUT /api/auth/me/email"], `${rejected}: refresh 뒤 다시 보내지 않는다`);
  }
  assert.equal(notified, 0);

  calls = [];
  code = null;
  assert.equal((await changeEmail(body)).email, "new@example.test");
  assert.deepEqual(calls, ["PUT /api/auth/me/email", "POST /api/auth/refresh", "PUT /api/auth/me/email"]);
});

test("이메일 변경 429는 Retry-After를 retryAfter(초)로 실어 던진다", async (t) => {
  saveAccessToken("email-access");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "MFA_RATE_LIMITED", message: "많음" } }, { status: 429, headers: { "Retry-After": "17" } }));
  await assert.rejects(changeEmail({ new_email: "a@b.test", verification_token: "vt" }), (error) => {
    assert.equal(error.code, "MFA_RATE_LIMITED");
    assert.equal(error.retryAfter, 17);
    return true;
  });
});

test("mock은 인증 토큰을 발급 주소·목적에 묶고, 이메일 변경 전에 본인을 확인한다", async (t) => {
  const timestamp = new Date().toISOString();
  const mfa = { enabled: false, activated_at: null, secret: null, recovery_codes: [] };
  state.users.push(
    { id: "user_mail", email: "mail@example.test", password: "pw1234", display_name: null, provider: "email", created_at: timestamp, mfa },
    { id: "user_taken", email: "taken@example.test", password: "x", display_name: null, provider: "email", created_at: timestamp, mfa },
    { id: "user_social", email: "social@example.test", display_name: null, provider: "google", created_at: timestamp, mfa }
  );
  const router = createRouter(state);
  registerAuthRoutes(router);
  t.mock.method(console, "log", () => {});
  const server = await listen(router, 0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body, token) => fetch(`${base}${path}`, {
    method: path === "/api/auth/me/email" ? "PUT" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  async function verifiedToken(email, purpose) {
    const { verification_id } = await (await post("/api/auth/email-verifications", { email, purpose })).json();
    return (await (await post(`/api/auth/email-verifications/${verification_id}/confirm`, { code: "123456" })).json()).verification_token;
  }
  const codeOf = async (response) => (await response.json()).error?.code;
  const access = issueAccessToken(state, "user_mail");

  const token = await verifiedToken("New@Example.test", "email_change");
  const otherAddress = await verifiedToken("other@example.test", "email_change");
  const signupToken = await verifiedToken("new@example.test", "signup");

  // 본인 확인이 토큰 검증보다 먼저다. 비밀번호가 틀리면 토큰을 소비하지 않는다.
  let response = await post("/api/auth/me/email", { new_email: "new@example.test", verification_token: token, current_password: "wrong" }, access);
  assert.equal(response.status, 401);
  assert.equal(await codeOf(response), "INVALID_CREDENTIALS");
  response = await post("/api/auth/me/email", { new_email: "new@example.test", verification_token: otherAddress, current_password: "pw1234" }, access);
  assert.equal(await codeOf(response), "INVALID_VERIFICATION_TOKEN", "다른 주소로 받은 토큰은 쓸 수 없다");
  response = await post("/api/auth/me/email", { new_email: "new@example.test", verification_token: signupToken, current_password: "pw1234" }, access);
  assert.equal(await codeOf(response), "INVALID_VERIFICATION_TOKEN", "다른 목적의 토큰은 쓸 수 없다");
  response = await post("/api/auth/signup", { email: "other@example.test", password: "pw", verification_token: otherAddress }, null);
  assert.equal(response.status, 400, "이메일 변경 토큰으로 가입할 수 없다");
  response = await post("/api/auth/me/email", { new_email: "taken@example.test", verification_token: await verifiedToken("taken@example.test", "email_change"), current_password: "pw1234" }, access);
  assert.equal(await codeOf(response), "DUPLICATE_EMAIL");

  response = await post("/api/auth/me/email", { new_email: "new@example.test", verification_token: token, current_password: "pw1234" }, access);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).email, "new@example.test");
  response = await post("/api/auth/me/email", { new_email: "new@example.test", verification_token: token, current_password: "pw1234" }, access);
  assert.equal(await codeOf(response), "INVALID_VERIFICATION_TOKEN", "토큰은 한 번만 쓴다");

  // 소셜 전용 계정은 10분 안에 직접 로그인한 토큰만 통과한다.
  const socialToken = await verifiedToken("social2@example.test", "email_change");
  response = await post("/api/auth/me/email", { new_email: "social2@example.test", verification_token: socialToken }, issueAccessToken(state, "user_social"));
  assert.equal(await codeOf(response), "REAUTHENTICATION_REQUIRED");
  response = await post("/api/auth/me/email", { new_email: "social2@example.test", verification_token: socialToken },
    issueAccessToken(state, "user_social", { authTime: Date.now() }));
  assert.equal(response.status, 200);

  // 비밀번호 실패가 5회를 넘으면 Retry-After와 함께 429다.
  for (let attempt = 0; attempt < 4; attempt++) {
    await post("/api/auth/me/email", { new_email: "x@example.test", verification_token: "vt", current_password: "wrong" }, access);
  }
  response = await post("/api/auth/me/email", { new_email: "x@example.test", verification_token: "vt", current_password: "pw1234" }, access);
  assert.equal(response.status, 429);
  assert.equal(await codeOf(response), "PASSWORD_CHANGE_RATE_LIMITED");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
});

test("인증번호 요청의 409 DUPLICATE_EMAIL은 서버 원문 대신 변경 단계와 같은 문구로 보인다", () => {
  const duplicate = Object.assign(new Error("이미 가입된 이메일입니다: email=other@example.com"), { code: "DUPLICATE_EMAIL", status: 409 });
  assert.equal(emailCodeRequestFailureMessage(duplicate), "이미 다른 계정이 사용 중인 이메일입니다.");
  assert.equal(emailCodeRequestFailureMessage(duplicate), emailChangeFailure(duplicate, "x").message);
  assert.equal(emailCodeRequestFailureMessage(withCode("RATE_LIMITED", 429)), null, "다른 실패는 호출부 문구를 쓴다");
  assert.equal(emailCodeRequestFailureMessage(null), null);
});
