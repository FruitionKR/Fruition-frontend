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

test("장 탭은 화면 폭 전체 바가 아니라 가운데 떠 있는 알약이고, 장 띠 여백이 탭보다 커서 장 제목을 가리지 않는다", () => {
  const tabs = readFileSync(new URL("../src/views/landing/ui/SectionTabs.module.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/views/landing/ui/LandingPage.module.css", import.meta.url), "utf8");
  // 바깥 nav는 클릭을 통과시키고 배경을 칠하지 않는다. 알약(ul)만 배경·클릭을 가진다.
  const navBlock = tabs.match(/\.section-tabs\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(navBlock, /pointer-events:\s*none/);
  assert.doesNotMatch(navBlock, /background|border-bottom/);
  assert.match(tabs, /\.section-tabs ul\s*\{[^}]*pointer-events:\s*auto[^}]*border-radius:\s*999px/s);
  // 장 띠는 헤더 바로 아래에서 시작하고, 띠 안쪽 여백(최소 80px)이 탭 높이(56px)보다 크다.
  assert.match(page, /section\[data-chapter\]\s*\{\s*scroll-margin-top:\s*var\(--lp-header-height\)/);
  const tabsHeight = Number(page.match(/--lp-tabs-height:\s*(\d+)px/)?.[1]);
  const pads = [...page.matchAll(/--lp-section-pad:\s*(\d+)px/g)].map((match) => Number(match[1]));
  assert.ok(pads.length >= 2 && Math.min(...pads) > tabsHeight);
});

test("현재 장은 화면 높이 45% 지점에 걸친 장으로 판단한다", () => {
  const source = readFileSync(new URL("../src/views/landing/ui/SectionTabs.tsx", import.meta.url), "utf8");
  assert.match(source, /SPY_ROOT_MARGIN = "-45% 0px -54% 0px"/);
});
