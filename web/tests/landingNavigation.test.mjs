import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("앵커 이동은 고정 헤더 아래로 맞추고, 부드러운 스크롤은 움직임 줄이기에서 끈다", () => {
  const css = readFileSync(new URL("../src/views/landing/ui/LandingPage.module.css", import.meta.url), "utf8");
  assert.match(css, /scroll-margin-top:\s*calc\(var\(--lp-header-height\) \+ 16px\)/);
  assert.match(css, /section\[data-chapter\]\s*\{\s*scroll-margin-top:\s*var\(--lp-header-height\)/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*scroll-behavior: smooth/s);
});
