import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱 소스의 확장자 없는 상대 import는 .ts로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { pickActiveChapter } = await import("../src/views/landing/model/sectionSpy.ts");

test("보이는 장 가운데 문서 순서상 첫 장을 현재 장으로 고른다", () => {
  assert.equal(pickActiveChapter(new Set(["discover", "connect"]), null), "connect");
  assert.equal(pickActiveChapter(new Set(["together"]), "discover"), "together");
});

test("보이는 장이 없으면(장 사이 여백) 직전 장을 유지한다", () => {
  assert.equal(pickActiveChapter(new Set(), "connect"), "connect");
  assert.equal(pickActiveChapter(new Set(), null), null);
});

test("탭 바는 스크롤 이벤트 없이 IntersectionObserver로만 갱신하고 현재 장에 aria-current를 단다", () => {
  const source = readFileSync(new URL("../src/views/landing/ui/SectionTabs.tsx", import.meta.url), "utf8");
  assert.match(source, /new IntersectionObserver/);
  assert.doesNotMatch(source, /addEventListener\(["']scroll/);
  assert.match(source, /aria-current=\{isActive \? "true" : undefined\}/);
});

test("앵커 이동은 헤더와 탭 바 높이만큼 아래로 맞추고, 부드러운 스크롤은 움직임 줄이기에서 끈다", () => {
  const css = readFileSync(new URL("../src/views/landing/ui/LandingPage.module.css", import.meta.url), "utf8");
  assert.match(css, /scroll-margin-top:\s*calc\(var\(--lp-header-height\) \+ var\(--lp-tabs-height\)/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*scroll-behavior: smooth/s);
});
