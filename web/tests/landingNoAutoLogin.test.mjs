import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const { isPublicAuthPath } = await import("../src/shared/lib/authSessionStorage.ts");

const SRC = new URL("../src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, SRC), "utf8");
// 주석의 설명 문구(예: "useMe({ enabled: false })")가 검사에 걸리지 않게 주석을 지운 코드만 본다.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) return sourceFiles(new URL(`${name}/`, dir));
    return /\.tsx?$/.test(name) ? [{ name, text: readFileSync(url, "utf8") }] : [];
  });
}

const landingFiles = sourceFiles(new URL("views/landing/", SRC));

test("랜딩은 로그인 상태여도 앱으로 자동 이동하지 않는다", () => {
  assert.equal(existsSync(new URL("views/landing/ui/LandingRedirect.tsx", SRC)), false);
  for (const { name, text } of landingFiles) {
    assert.doesNotMatch(text, /LandingRedirect|router\.replace\(\s*["']\/workspaces/, name);
  }
});

test("랜딩은 세션 확인 요청(/api/auth/me·refresh)을 보내지 않는다", () => {
  for (const { name, text } of landingFiles) {
    assert.doesNotMatch(stripComments(text), /\buseMe\b|\bfetchMe\b|apiClient|\/api\/auth\//, name);
  }
  // 모든 화면에 걸리는 전역 provider도 랜딩(/)에서는 /me를 부르지 않는다.
  assert.equal(isPublicAuthPath("/"), true);
  assert.match(read("app/AnalyticsProvider.tsx"), /useMe\(\{ enabled: [^}]*!isPublicAuthPath\(pathname\)/);
  assert.match(read("features/legal-consent/ui/ReconsentGate.tsx"), /isProtectedScreen = !isPublicAuthPath\(pathname\)/);
  assert.match(read("entities/user/model/UserPreferencesProvider.tsx"), /if \(isPublicAuthPath\(pathname\)\) \{[^}]*return;/s);
  // 계정 언어 맞추기는 me 캐시만 읽는다.
  const localeSync = stripComments(read("entities/user/ui/AccountLocaleSync.tsx"));
  assert.doesNotMatch(localeSync, /\buseMe\(|\bfetchMe\b|refetchQueries|fetchQuery/);
});

test("랜딩의 로그인·시작 버튼은 /login으로 가고, /login이 살아 있는 세션을 이어 받는다", () => {
  const loginLinks = landingFiles.flatMap(({ text }) => text.match(/href="\/(?:login|signup)[^"]*"/g) ?? []);
  assert.ok(loginLinks.length >= 3, "헤더 로그인·히어로 시작·하단 시작 버튼");
  assert.ok(loginLinks.every((href) => href === 'href="/login"'), loginLinks.join(", "));
  const loginPage = read("views/auth/ui/LoginPage.tsx");
  assert.match(loginPage, /isSuccess: isAlreadySignedIn \} = useMe\(/);
  assert.match(loginPage, /if \(isAlreadySignedIn\) router\.replace\(takeAfterLoginPath\(\)\)/);
  // 직접 로그아웃한 뒤에는 남은 refresh 쿠키로 방금 나온 계정에 되돌려 보내지 않는다(랜딩이 하던 보호를 이어받음).
  assert.match(loginPage, /isAlreadySignedIn \} = useMe\(\{ enabled: [^}]*!isSignedOutByUser\(\)/);
});
