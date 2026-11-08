import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("없는 경로는 인증 조회 없이 안내와 랜딩 복귀 링크를 렌더링한다", () => {
  const page = read("../app/not-found.tsx");
  assert.match(page, /useTranslations\("common.notFound"\)/);
  assert.match(page, /<AuthScreen title=\{t\("title"\)\}/);
  assert.match(page, /t\("description"\)/);
  assert.match(page, /href="\/"/);
  assert.match(page, /prefetch=\{false\}/);
  assert.match(page, /t\("back"\)/);
  assert.doesNotMatch(page, /useMe|fetch\(|redirect\(|router\.|\/api\/auth/);
});

test("404 안내는 한국어와 영어 제목·주소 확인·복귀 문구를 제공한다", () => {
  for (const locale of ["ko", "en"]) {
    const messages = JSON.parse(read(`../src/shared/i18n/messages/${locale}/common.json`));
    for (const key of ["title", "description", "back"]) {
      assert.equal(typeof messages.notFound?.[key], "string", `${locale}: ${key}`);
      assert.ok(messages.notFound[key].trim());
    }
  }
});

test("404 경계에서는 분석·재동의 provider의 인증 조회도 실행하지 않는다", () => {
  const providers = read("../src/app/providers.tsx");
  assert.match(providers, /useSelectedLayoutSegment/);
  assert.match(providers, /if \(segment === "\/_not-found"\) return children/);
});
