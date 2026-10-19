import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const { LANDING_CHAPTERS, LANDING_FAQ, LANDING_NAV } = await import("../src/views/landing/model/landingContent.ts");

const UI_DIR = new URL("../src/views/landing/ui/", import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), "utf8");
const listFiles = (extension) => [
  ...readdirSync(UI_DIR).filter((name) => name.endsWith(extension)),
  ...readdirSync(new URL("preview/", UI_DIR))
    .filter((name) => name.endsWith(extension))
    .map((name) => `preview/${name}`)
];

test("장은 01 모으고 쓰기 → 02 지식으로 연결 → 03 활용 → 04 팀으로 확장 순서다", () => {
  assert.deepEqual(
    LANDING_CHAPTERS.map((chapter) => [chapter.index, chapter.id, chapter.indexLabel]),
    [
      ["01", "capture", "모으고 쓰기"],
      ["02", "connect", "지식으로 연결"],
      ["03", "discover", "활용"],
      ["04", "together", "팀으로 확장"]
    ]
  );
});

test("헤더 메뉴는 모으기·연결하기·활용하기·함께하기이고 각 장 앵커로 간다", () => {
  assert.deepEqual(
    LANDING_NAV.map((item) => [item.label, item.href]),
    [
      ["모으기", "#capture"],
      ["연결하기", "#connect"],
      ["활용하기", "#discover"],
      ["함께하기", "#together"]
    ]
  );
});

test("화면 조각은 01·03이 왼쪽, 02·04가 오른쪽이다", () => {
  assert.deepEqual(
    LANDING_CHAPTERS.map((chapter) => chapter.visualSide),
    ["left", "right", "left", "right"]
  );
});

test("장 문구는 정해진 영어 부제와 괄호 병기 기능 이름을 그대로 쓴다", () => {
  assert.deepEqual(
    LANDING_CHAPTERS.map((chapter) => chapter.english),
    ["CAPTURE & ORGANIZE", "CONNECT THE DOTS", "PUT KNOWLEDGE TO WORK", "BUILD TOGETHER"]
  );
  assert.ok(LANDING_CHAPTERS[1].chips.includes("지식 그래프(Graph)"));
  assert.ok(LANDING_CHAPTERS[2].chips.includes("자연어 질의응답(Query)"));
});

test("충돌을 사람이 직접 해결한다는 문구를 쓰지 않는다(자동 병합)", () => {
  const copy = JSON.stringify([LANDING_CHAPTERS, LANDING_FAQ]) + listFiles(".tsx").map(read).join("\n");
  assert.doesNotMatch(copy, /충돌 기록|충돌을 확인|충돌 확인|합칩니다/);
  assert.match(LANDING_CHAPTERS[3].body, /자동 병합·버전 기록/);
});

test("팀 장은 테마를 따른다(강제 다크 띠·토큰 덮어쓰기 없음)", () => {
  const css = listFiles(".css").map(read).join("\n");
  assert.doesNotMatch(css, /\.team\s*\{/);
  assert.doesNotMatch(css, /\.team-frame\s*\{/);
});

test("랜딩 애니메이션은 움직임 줄이기 설정에서 꺼지고 transform·opacity만 움직인다", () => {
  assert.match(read("LandingPage.module.css"), /@media \(prefers-reduced-motion: reduce\)/);
  const css = listFiles(".css").map(read).join("\n");
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
