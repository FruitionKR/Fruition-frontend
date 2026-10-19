import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { LANDING_CHAPTERS, LANDING_FAQ, LANDING_FLOW, nextTabIndex } = await import(
  "../src/views/landing/model/landingContent.ts"
);

test("랜딩 장 순서는 기록 → 지식화 → 활용 → 협업이고 #capture 앵커로 시작한다", () => {
  assert.deepEqual(
    LANDING_CHAPTERS.map((chapter) => [chapter.id, chapter.navLabel]),
    [
      ["capture", "기록"],
      ["connect", "지식화"],
      ["discover", "활용"],
      ["together", "협업"]
    ]
  );
});

test("장 id와 번호는 겹치지 않고, 각 장은 소개할 기능을 하나 이상 가진다", () => {
  assert.equal(new Set(LANDING_CHAPTERS.map((chapter) => chapter.id)).size, LANDING_CHAPTERS.length);
  assert.deepEqual(
    LANDING_CHAPTERS.map((chapter) => chapter.index),
    ["01", "02", "03", "04"]
  );
  for (const chapter of LANDING_CHAPTERS) {
    assert.ok(chapter.features.length > 0, `${chapter.id} 기능 목록이 비어 있다`);
  }
});

test("흐름 단계는 장 수와 같고, FAQ 질문은 겹치지 않는다", () => {
  assert.equal(LANDING_FLOW.length, LANDING_CHAPTERS.length);
  assert.equal(new Set(LANDING_FAQ.map((item) => item.question)).size, LANDING_FAQ.length);
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
  const read = (name) => readFileSync(new URL(`../src/views/landing/ui/${name}`, import.meta.url), "utf8");
  // 랜딩 전체(.landing-page *)의 애니메이션·전환을 끄는 규칙은 페이지 모듈에 둔다.
  assert.match(read("LandingPage.module.css"), /@media \(prefers-reduced-motion: reduce\)/);
  const css = ["LandingPage.module.css", "LandingChapterSection.module.css", "LandingClosing.module.css", "LandingMocks.module.css"]
    .map(read)
    .join("\n");
  const keyframes = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g) ?? [];
  assert.ok(keyframes.length > 0, "keyframes가 있어야 한다");
  for (const block of keyframes) {
    const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    for (const property of properties) assert.ok(["transform", "opacity"].includes(property), `${property}는 애니메이션하지 않는다`);
  }
});
