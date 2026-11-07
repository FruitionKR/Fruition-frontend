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
const { getLoginErrorMessage: getLoginErrorMessageWith } = await import("../src/views/auth/lib/loginErrorMessage.ts");
const { readFileSync } = await import("node:fs");
// 화면과 같이 auth.loginErrors 키를 한국어 메시지로 바꿔 문구까지 확인한다.
const { loginErrors } = JSON.parse(readFileSync(new URL("../src/shared/i18n/messages/ko/auth.json", import.meta.url), "utf8"));
const getLoginErrorMessage = (error, isServerUnready) => getLoginErrorMessageWith(error, isServerUnready, (key) => loginErrors[key]);
const INVALID_CREDENTIALS_MESSAGE = "가입하지 않은 아이디거나, 잘못된 비밀번호입니다.";
const SERVER_PREPARING_MESSAGE = "서버가 아직 준비 중이에요. 준비가 끝나면 다시 로그인해 주세요.";
const TOO_MANY_LOGIN_ATTEMPTS_MESSAGE = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
const LOGIN_SERVER_ERROR_MESSAGE = "서버 오류로 로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const LOGIN_NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

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

test("스크립트가 붙기 전에는 제출을 막고, 그동안 입력한 값을 서버가 그린 인증 폼의 상태로 옮긴다", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  assert.match(await read("shared/ui/auth/AuthControls.tsx"), /disabled=\{disabled \|\| !isHydrated\}/);
  for (const page of ["LoginPage", "SignupPage", "ForgotPasswordPage"]) {
    const source = await read(`views/auth/ui/${page}.tsx`);
    assert.match(source, /useTypedFormValues\(\{/, page);
    assert.match(source, /ref=\{formRef\}/, page);
    assert.match(source, /method="post"/, "제출이 새더라도 입력이 URL에 나가지 않게 POST를 유지한다");
  }
});

test("폼에 남은 값만 입력 이름별 상태로 옮기고, 비어 있으면 상태를 그대로 둔다", async () => {
  const { adoptTypedValues } = await import("../src/shared/hooks/useTypedFormValues.ts");
  const adopted = {};
  const setter = (name) => (value) => { adopted[name] = value; };
  const form = new FormData();
  form.set("email", "demo@fruition.local");
  form.set("nickname", "");
  adoptTypedValues(form, { email: setter("email"), nickname: setter("nickname"), password: setter("password") });
  assert.deepEqual(adopted, { email: "demo@fruition.local" });
});
