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

const { buildCurrentPasswordChangeBody } = await import("../src/entities/user/model/passwordChange.ts");
const { changePassword } = await import("../src/entities/user/api/account.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const { createRouter, listen, issueAccessToken } = await import("../mock/lib/http.mjs");
const { state } = await import("../mock/state.mjs");
const { registerAuthRoutes } = await import("../mock/routes/auth.mjs");

test("현재 비밀번호 변경 본문은 MFA 코드를 입력했을 때만 mfa_code를 넣는다", () => {
  assert.deepEqual(buildCurrentPasswordChangeBody({ currentPassword: "old", newPassword: "newPassword1234", mfaCode: " " }), {
    current_password: "old",
    new_password: "newPassword1234"
  });
  assert.deepEqual(buildCurrentPasswordChangeBody({ currentPassword: "old", newPassword: "newPassword1234", mfaCode: " 123456 " }), {
    current_password: "old",
    new_password: "newPassword1234",
    mfa_code: "123456"
  });
});

test("현재 비밀번호 변경 API는 MFA 코드가 있으면 mfa_code를 함께, 없으면 기존 본문 그대로 보낸다", async (t) => {
  saveAccessToken("password-access");
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/auth/me/password");
    assert.equal(init.method, "PUT");
    bodies.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  });
  await changePassword("old", "newPassword1234");
  await changePassword("old", "newPassword1234", "654321");
  assert.deepEqual(bodies, [
    { current_password: "old", new_password: "newPassword1234" },
    { current_password: "old", new_password: "newPassword1234", mfa_code: "654321" }
  ]);
});

test("현재 비밀번호 변경의 MFA 코드 불일치(401 INVALID_MFA_CODE)는 재발급·재전송 없이 호출부에 던진다", async (t) => {
  saveAccessToken("password-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/auth/refresh") return Response.json({ access_token: "fresh" });
    return Response.json({ error: { code: "INVALID_MFA_CODE", message: "인증 코드가 올바르지 않습니다." } }, { status: 401 });
  });
  await assert.rejects(changePassword("old", "newPassword1234", "000000"), (error) => {
    assert.equal(error.code, "INVALID_MFA_CODE");
    assert.equal(error.status, 401);
    assert.equal(error.message, "인증 코드가 올바르지 않습니다.");
    return true;
  });
  assert.deepEqual(calls, ["PUT /api/auth/me/password"]);
});

test("mock은 현재 비밀번호를 먼저 확인하고, MFA를 켠 계정은 이어서 인증 코드를 확인한다", async (t) => {
  const timestamp = new Date().toISOString();
  const mfaOff = { enabled: false, activated_at: null, secret: null, recovery_codes: [] };
  const mfaOn = { enabled: true, activated_at: timestamp, secret: "secret", recovery_codes: ["abcd-1234"] };
  state.users.push(
    { id: "user_cur_pw", email: "curpw@example.test", password: "pw123456", display_name: null, provider: "email", created_at: timestamp, mfa: mfaOff },
    { id: "user_cur_mfa", email: "curmfa@example.test", password: "pw123456", display_name: null, provider: "email", created_at: timestamp, mfa: mfaOn },
    { id: "user_cur_limit", email: "curlimit@example.test", password: "pw123456", display_name: null, provider: "email", created_at: timestamp, mfa: mfaOn }
  );
  const router = createRouter(state);
  registerAuthRoutes(router);
  const server = await listen(router, 0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const put = (body, userId) => fetch(`${base}/api/auth/me/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${issueAccessToken(state, userId)}` },
    body: JSON.stringify(body)
  });
  const codeOf = async (response) => (await response.json()).error?.code;
  const passwordOf = (userId) => state.users.find((user) => user.id === userId).password;

  // MFA를 끈 계정은 기존과 같다.
  let response = await put({ current_password: "wrong", new_password: "offPassword1234" }, "user_cur_pw");
  assert.equal(await codeOf(response), "INVALID_CREDENTIALS");
  response = await put({ current_password: "pw123456", new_password: "offPassword1234" }, "user_cur_pw");
  assert.equal(response.status, 204);
  assert.equal(passwordOf("user_cur_pw"), "offPassword1234");

  // 비밀번호가 틀리면 MFA 코드와 관계없이 INVALID_CREDENTIALS가 먼저 나온다.
  response = await put({ current_password: "wrong", new_password: "mfaPassword1234" }, "user_cur_mfa");
  assert.equal(response.status, 401);
  assert.equal(await codeOf(response), "INVALID_CREDENTIALS");

  // 비밀번호가 맞아도 코드가 없거나 틀리면 INVALID_MFA_CODE이고 비밀번호는 바뀌지 않는다.
  for (const mfa_code of [undefined, "12345"]) {
    response = await put({ current_password: "pw123456", new_password: "mfaPassword1234", mfa_code }, "user_cur_mfa");
    assert.equal(response.status, 401);
    assert.equal(await codeOf(response), "INVALID_MFA_CODE");
  }
  assert.equal(passwordOf("user_cur_mfa"), "pw123456");
  response = await put({ current_password: "pw123456", new_password: "mfaPassword1234", mfa_code: "abcd-1234" }, "user_cur_mfa");
  assert.equal(response.status, 204);
  assert.equal(passwordOf("user_cur_mfa"), "mfaPassword1234");

  // 코드 실패가 한도를 넘으면 맞는 코드도 429 MFA_RATE_LIMITED로 막는다.
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await put({ current_password: "pw123456", new_password: "limitPassword1234", mfa_code: "bad" }, "user_cur_limit");
    assert.equal(await codeOf(response), "INVALID_MFA_CODE");
  }
  response = await put({ current_password: "pw123456", new_password: "limitPassword1234", mfa_code: "123456" }, "user_cur_limit");
  assert.equal(response.status, 429);
  assert.equal(await codeOf(response), "MFA_RATE_LIMITED");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal(passwordOf("user_cur_limit"), "pw123456");
});
