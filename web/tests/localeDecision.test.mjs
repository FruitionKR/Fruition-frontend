import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱 소스의 확장자 없는 상대 import는 .ts로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  }
});

const { clientIpFromForwardedFor, decideLocale, matchAcceptLanguage, shouldRememberDecision, AUTO_LOCALE_COOKIE, LOCALE_COOKIE } = await import("../src/shared/i18n/locale.ts");
const { isKoreanIp, parseIp, isPrivateIp } = await import("../src/shared/i18n/ipCountry.ts");
const { decideRequestLocale, rememberLocaleDecision } = await import("../src/shared/i18n/localeMiddleware.ts");
const { NextRequest, NextResponse } = await import("next/server.js");

const neverKorean = () => false;
const alwaysKorean = () => true;
const unknownIp = () => null;

test("사용자가 고른 언어가 IP·Accept-Language보다 먼저다", () => {
  assert.deepEqual(decideLocale({ userLocale: "en", autoLocale: "ko", ip: "1.11.0.1", acceptLanguage: "ko", isKoreanIp: alwaysKorean }), { locale: "en", source: "user" });
});

test("지난번 자동 판정 쿠키가 있으면 IP를 다시 보지 않는다", () => {
  let looked = false;
  const decision = decideLocale({ autoLocale: "en", ip: "1.11.0.1", isKoreanIp: () => { looked = true; return true; } });
  assert.deepEqual(decision, { locale: "en", source: "auto" });
  assert.equal(looked, false);
});

test("IP가 한국이면 ko, 그 밖의 공인 IP는 en이다(Accept-Language보다 먼저)", () => {
  assert.deepEqual(decideLocale({ ip: "1.11.0.1", acceptLanguage: "en-US", isKoreanIp: alwaysKorean }), { locale: "ko", source: "ip" });
  assert.deepEqual(decideLocale({ ip: "8.8.8.8", acceptLanguage: "ko-KR", isKoreanIp: neverKorean }), { locale: "en", source: "ip" });
});

test("IP로 판정할 수 없으면 Accept-Language, 그것도 없으면 기본 ko", () => {
  assert.deepEqual(decideLocale({ ip: "127.0.0.1", acceptLanguage: "en-US,en;q=0.9", isKoreanIp: unknownIp }), { locale: "en", source: "accept-language" });
  assert.deepEqual(decideLocale({ ip: null, acceptLanguage: "ja-JP", isKoreanIp: unknownIp }), { locale: "ko", source: "default" });
  assert.deepEqual(decideLocale({ isKoreanIp: unknownIp }), { locale: "ko", source: "default" });
});

test("잘못된 쿠키 값은 무시한다", () => {
  assert.deepEqual(decideLocale({ userLocale: "fr", autoLocale: "<x>", ip: "8.8.8.8", isKoreanIp: neverKorean }), { locale: "en", source: "ip" });
});

test("Accept-Language는 q값 순서로 지원 언어를 고른다", () => {
  assert.equal(matchAcceptLanguage("ja;q=1, en;q=0.5, ko;q=0.8"), "ko");
  assert.equal(matchAcceptLanguage("en-GB, ko;q=0.9"), "en");
  assert.equal(matchAcceptLanguage("ko;q=0, en;q=0.1"), "en");
  assert.equal(matchAcceptLanguage("*"), null);
  assert.equal(matchAcceptLanguage(""), null);
});

test("X-Forwarded-For의 첫 값을 클라이언트 IP로 쓴다", () => {
  assert.equal(clientIpFromForwardedFor("203.0.113.5, 10.0.0.1"), "203.0.113.5");
  assert.equal(clientIpFromForwardedFor(" 2001:db8::1 "), "2001:db8::1");
  assert.equal(clientIpFromForwardedFor(null), null);
  assert.equal(clientIpFromForwardedFor(""), null);
});

test("새로 판정한 결과만 자동 판정 쿠키로 남긴다", () => {
  assert.equal(shouldRememberDecision({ locale: "en", source: "ip" }), true);
  assert.equal(shouldRememberDecision({ locale: "en", source: "accept-language" }), true);
  assert.equal(shouldRememberDecision({ locale: "ko", source: "user" }), false);
  assert.equal(shouldRememberDecision({ locale: "ko", source: "auto" }), false);
});

test("사설·루프백·링크 로컬 주소는 국가를 판정하지 않는다", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.1.1", "100.64.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isKoreanIp(ip), null, ip);
  }
  assert.equal(isPrivateIp(parseIp("172.32.0.1")), false);
});

test("해석할 수 없는 주소는 판정하지 않는다", () => {
  for (const ip of ["", "unknown", "1.2.3", "256.1.1.1", "1:2:3", "1::2::3", "gggg::1"]) assert.equal(isKoreanIp(ip), null, ip);
});

test("한국 대역과 다른 나라 대역을 구분한다(IPv4·IPv6·IPv4-mapped)", () => {
  // 1.208.0.0/12와 1.11.0.0/16은 한국 통신사 대역, 2001:220::/32는 KRNIC 대역이다.
  for (const ip of ["1.11.0.1", "1.255.255.255", "211.234.10.20", "2001:220::1", "::ffff:1.11.0.1", "[2001:220::1]:443", "1.11.0.1:8080"]) assert.equal(isKoreanIp(ip), true, ip);
  // 미국 Google DNS, 일본 NTT, 독일 대역
  for (const ip of ["8.8.8.8", "1.0.0.1", "2001:4860:4860::8888", "2001:200::1", "::ffff:8.8.8.8"]) assert.equal(isKoreanIp(ip), false, ip);
});

test("미들웨어는 쿠키·X-Forwarded-For·Accept-Language를 읽어 언어를 정한다", () => {
  const request = (headers) => new NextRequest("http://localhost/", { headers });
  assert.deepEqual(decideRequestLocale(request({ "x-forwarded-for": "8.8.8.8, 10.0.0.2" })), { locale: "en", source: "ip" });
  assert.deepEqual(decideRequestLocale(request({ "x-forwarded-for": "211.234.10.20" })), { locale: "ko", source: "ip" });
  assert.deepEqual(decideRequestLocale(request({ "x-forwarded-for": "127.0.0.1", "accept-language": "en" })), { locale: "en", source: "accept-language" });
  assert.deepEqual(decideRequestLocale(request({ cookie: `${LOCALE_COOKIE}=ko`, "x-forwarded-for": "8.8.8.8" })), { locale: "ko", source: "user" });
});

test("자동 판정 쿠키는 새로 판정했을 때만 응답에 붙는다", () => {
  const fresh = rememberLocaleDecision(NextResponse.next(), { locale: "en", source: "ip" });
  assert.equal(fresh.cookies.get(AUTO_LOCALE_COOKIE)?.value, "en");
  const chosen = rememberLocaleDecision(NextResponse.next(), { locale: "en", source: "user" });
  assert.equal(chosen.cookies.get(AUTO_LOCALE_COOKIE), undefined);
});
