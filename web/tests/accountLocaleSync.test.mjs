import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱의 경로 별칭과 확장자 없는 상대 import를 .ts 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !context.parentURL?.includes("/node_modules/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { readCookie, resolveRequestLocale, withLocaleHeader, localizedFetch } = await import("../src/shared/i18n/requestLocale.ts");
const { decideLocaleSync, shouldSaveChosenLocale, supportsAccountLocale } = await import("../src/shared/i18n/localeSync.ts");
const { accountDeletionVerification, buildAccountDeletionBody } = await import("../src/entities/user/model/accountDeletion.ts");
const { apiFetch } = await import("../src/shared/api/client.ts");
const { updateAccountLocale } = await import("../src/entities/user/api/auth.ts");

/** 브라우저의 document(쿠키·<html lang>)를 잠시 흉내 낸다. */
function withDocument(t, { cookie = "", lang = "" }) {
  globalThis.document = { cookie, documentElement: { lang } };
  t.after(() => { delete globalThis.document; });
}

test("쿠키 문자열에서 이름이 정확히 같은 쿠키만 읽는다", () => {
  const cookie = "fruition.locale-auto=ko; fruition.locale=en; other=1";
  assert.equal(readCookie(cookie, "fruition.locale"), "en");
  assert.equal(readCookie(cookie, "fruition.locale-auto"), "ko");
  assert.equal(readCookie(cookie, "missing"), null);
  assert.equal(readCookie("", "fruition.locale"), null);
});

test("요청 언어는 직접 고른 쿠키 → 자동 판정 쿠키 → <html lang> 순으로 정하고, 모르는 값은 무시한다", () => {
  assert.equal(resolveRequestLocale({ cookie: "fruition.locale=en; fruition.locale-auto=ko", documentLang: "ko" }), "en");
  assert.equal(resolveRequestLocale({ cookie: "fruition.locale-auto=en", documentLang: "ko" }), "en");
  assert.equal(resolveRequestLocale({ cookie: "fruition.locale=fr", documentLang: "en" }), "en");
  assert.equal(resolveRequestLocale({ cookie: "", documentLang: "" }), null);
});

test("Accept-Language는 호출부가 정한 값을 덮어쓰지 않고, 언어를 모르면 붙이지 않는다", () => {
  assert.equal(withLocaleHeader({ "Content-Type": "application/json" }, "en").get("Accept-Language"), "en");
  assert.equal(withLocaleHeader({ "Content-Type": "application/json" }, "en").get("Content-Type"), "application/json");
  assert.equal(withLocaleHeader({ "Accept-Language": "ko" }, "en").get("Accept-Language"), "ko");
  assert.equal(withLocaleHeader(undefined, null).has("Accept-Language"), false);
});

test("apiFetch(SSE 포함)와 토큰 없는 직접 호출 모두 화면 언어를 Accept-Language로 보낸다", async (t) => {
  withDocument(t, { cookie: "fruition.locale=en", lang: "ko" });
  const seen = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    seen.push([path, new Headers(init.headers).get("Accept-Language"), new Headers(init.headers).get("Accept")]);
    return Response.json({});
  });
  await apiFetch("/api/workspaces/ws/agent/runs/r1/events", { headers: { Accept: "text/event-stream" } });
  await localizedFetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.deepEqual(seen, [
    ["/api/workspaces/ws/agent/runs/r1/events", "en", "text/event-stream"],
    ["/api/auth/login", "en", null]
  ]);
});

test("언어 저장은 PATCH /api/auth/me/locale에 { locale }을 보내고 MeResponse를 돌려준다", async (t) => {
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/auth/me/locale");
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(init.body), { locale: "en" });
    return Response.json({ id: "u1", locale: "en" });
  });
  assert.deepEqual(await updateAccountLocale("en"), { id: "u1", locale: "en" });
});

test("직접 고른 언어가 없으면 계정 언어를 화면에 적용한다", () => {
  assert.deepEqual(decideLocaleSync({ serverLocale: "en", chosenLocale: null }), { type: "adopt", locale: "en" });
  // 계정에 아직 저장한 언어가 없으면 자동 판정 언어를 서버에 올리지 않는다.
  assert.deepEqual(decideLocaleSync({ serverLocale: null, chosenLocale: null }), { type: "none" });
});

test("이 브라우저에서 직접 고른 언어가 있으면 그 값이 우선이고, 다를 때만 서버에 맞춘다", () => {
  assert.deepEqual(decideLocaleSync({ serverLocale: "ko", chosenLocale: "en" }), { type: "push", locale: "en" });
  assert.deepEqual(decideLocaleSync({ serverLocale: null, chosenLocale: "ko" }), { type: "push", locale: "ko" });
  assert.deepEqual(decideLocaleSync({ serverLocale: "en", chosenLocale: "en" }), { type: "none" });
});

test("locale 필드가 없는 구 서버면 쿠키만 쓰는 기존 동작을 유지한다", () => {
  assert.deepEqual(decideLocaleSync({ serverLocale: undefined, chosenLocale: "en" }), { type: "none" });
  assert.equal(supportsAccountLocale({ id: "u1" }), false);
  assert.equal(supportsAccountLocale(undefined), false);
  assert.equal(supportsAccountLocale({ id: "u1", locale: null }), true);
  assert.equal(shouldSaveChosenLocale({ id: "u1" }, "en"), false);
});

test("언어를 고르면 로그인해 계정 언어를 지원하는 서버에서 값이 다를 때만 저장한다", () => {
  assert.equal(shouldSaveChosenLocale(undefined, "en"), false);
  assert.equal(shouldSaveChosenLocale({ id: "u1", locale: "ko" }, "en"), true);
  assert.equal(shouldSaveChosenLocale({ id: "u1", locale: null }, "en"), true);
  assert.equal(shouldSaveChosenLocale({ id: "u1", locale: "en" }, "en"), false);
});

test("비밀번호 계정의 탈퇴는 비밀번호만 확인한다(소셜 연결이 있어도 재로그인은 보이지 않는다)", () => {
  assert.deepEqual(accountDeletionVerification({ has_password: true, oauth_providers: ["google"] }), {
    showPassword: true, requirePassword: true, showSocialRelogin: false, showSocialPasswordHint: false
  });
  assert.deepEqual(accountDeletionVerification({ has_password: true, oauth_providers: [] }), {
    showPassword: true, requirePassword: true, showSocialRelogin: false, showSocialPasswordHint: false
  });
});

test("비밀번호 없는 소셜 계정의 탈퇴는 비밀번호 칸 없이 소셜 재로그인만 보인다", () => {
  assert.deepEqual(accountDeletionVerification({ has_password: false, oauth_providers: ["google", "kakao"] }), {
    showPassword: false, requirePassword: false, showSocialRelogin: true, showSocialPasswordHint: false
  });
  // 비밀번호 칸이 없으면 본문에 비밀번호를 넣지 않는다(모달은 숨긴 칸 값을 빈 문자열로 넘긴다).
  assert.deepEqual(buildAccountDeletionBody({ password: "", mfaCode: "123456" }), { mfa_code: "123456" });
});

test("has_password가 없는 구 서버는 비밀번호 칸과 소셜 재로그인을 함께 보이는 기존 화면을 유지한다", () => {
  assert.deepEqual(accountDeletionVerification({ oauth_providers: ["google"] }), {
    showPassword: true, requirePassword: false, showSocialRelogin: true, showSocialPasswordHint: true
  });
  assert.deepEqual(accountDeletionVerification({}), {
    showPassword: true, requirePassword: false, showSocialRelogin: false, showSocialPasswordHint: false
  });
});
