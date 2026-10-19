import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const { LANDING_BENTO, LANDING_FAQ, LANDING_FEATURES, LANDING_NAV, LANDING_USE_CASES, nextTabIndex } = await import(
  "../src/views/landing/model/landingContent.ts"
);

const UI_DIR = new URL("../src/views/landing/ui/", import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), "utf8");
const cssFiles = [
  ...readdirSync(UI_DIR).filter((name) => name.endsWith(".css")),
  ...readdirSync(new URL("preview/", UI_DIR))
    .filter((name) => name.endsWith(".css"))
    .map((name) => `preview/${name}`)
];
const tsxFiles = [
  ...readdirSync(UI_DIR).filter((name) => name.endsWith(".tsx")),
  ...readdirSync(new URL("preview/", UI_DIR))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `preview/${name}`)
];

test("핵심 기능은 올리기 → 위키 → 근거 답변 순서이고 #capture 앵커로 시작한다", () => {
  assert.deepEqual(
    LANDING_FEATURES.map((feature) => feature.id),
    ["capture", "connect", "discover"]
  );
  assert.equal(LANDING_NAV[0].href, "#capture");
});

test("메뉴 앵커는 모두 랜딩의 섹션 id를 가리킨다", () => {
  const source = tsxFiles.map(read).join("\n");
  for (const item of LANDING_NAV) {
    const id = item.href.slice(1);
    const isFeature = LANDING_FEATURES.some((feature) => feature.id === id);
    assert.ok(isFeature || source.includes(`id="${id}"`), `${item.href} 섹션이 없다`);
  }
});

test("기능 묶음 5개 · 활용 사례 3개 · FAQ는 겹치지 않는다", () => {
  assert.deepEqual(
    LANDING_BENTO.map((item) => item.id),
    ["approve", "skills", "dictation", "lint", "history"]
  );
  assert.deepEqual(
    LANDING_USE_CASES.map((useCase) => useCase.tab),
    ["연구실", "스타트업", "학생"]
  );
  assert.equal(new Set(LANDING_FAQ.map((item) => item.question)).size, LANDING_FAQ.length);
});

test("문구에 영어 병기 괄호와 영어 대문자 꼬리표를 쓰지 않는다", () => {
  const copy = JSON.stringify([LANDING_FEATURES, LANDING_BENTO, LANDING_USE_CASES, LANDING_FAQ]);
  assert.doesNotMatch(copy, /\([A-Za-z][A-Za-z ]*\)/);
  const pageSource = ["LandingPage.tsx", "LandingSections.tsx", "LandingClosing.tsx"].map(read).join("\n");
  assert.doesNotMatch(pageSource, />[A-Z]{2,}(?: [A-Z&]{2,})+</);
});

test("탭 키보드 이동은 좌우 화살표로 순환하고 Home/End로 양 끝에 간다", () => {
  assert.equal(nextTabIndex(0, "ArrowRight", 3), 1);
  assert.equal(nextTabIndex(2, "ArrowRight", 3), 0);
  assert.equal(nextTabIndex(0, "ArrowLeft", 3), 2);
  assert.equal(nextTabIndex(1, "Home", 3), 0);
  assert.equal(nextTabIndex(0, "End", 3), 2);
});

test("탭 이동과 관계없는 키나 빈 탭 목록에서는 현재 위치를 유지한다", () => {
  assert.equal(nextTabIndex(1, "Enter", 3), 1);
  assert.equal(nextTabIndex(0, "ArrowRight", 0), 0);
});

test("랜딩 애니메이션은 움직임 줄이기 설정에서 꺼지고 transform·opacity만 움직인다", () => {
  assert.match(read("LandingPage.module.css"), /@media \(prefers-reduced-motion: reduce\)/);
  const css = cssFiles.map(read).join("\n");
  const keyframes = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g) ?? [];
  assert.ok(keyframes.length > 0, "keyframes가 있어야 한다");
  for (const block of keyframes) {
    const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    for (const property of properties) assert.ok(["transform", "opacity"].includes(property), `${property}는 애니메이션하지 않는다`);
  }
});

test("랜딩 포인트 색은 앱 토큰(--color-primary 계열)을 쓰고, 로고는 /home 레일과 같은 컴포넌트를 쓴다", () => {
  const css = read("LandingPage.module.css");
  assert.match(css, /--lp-accent:\s*var\(--color-primary\);/);
  assert.match(css, /--lp-accent-ink:\s*var\(--color-primary-weak-foreground\);/);
  assert.match(css, /\.button-primary\s*\{[^}]*background:\s*var\(--lp-accent\);/s);
  assert.doesNotMatch(css, /fruition-logo\.svg/);
  assert.match(read("LandingPage.tsx"), /<RailLogoIcon \/>/);
});

test("제목 단계는 제목1 64px · 제목2 40px · 본문 18px을 넘지 않는다", () => {
  const css = read("LandingPage.module.css");
  assert.match(css, /--lp-text-h1:\s*clamp\([^)]*4rem\)/);
  assert.match(css, /--lp-text-h2:\s*clamp\([^)]*2\.5rem\)/);
  assert.match(css, /--lp-text-body:\s*clamp\([^)]*1\.125rem\)/);
});
