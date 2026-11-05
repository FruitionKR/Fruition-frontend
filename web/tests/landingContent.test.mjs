import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const { LANDING_CHAPTERS, LANDING_DEMO_SLOTS, LANDING_FAQ, LANDING_NAV, landingNavLabel } = await import("../src/views/landing/model/landingContent.ts");

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

test("헤더 메뉴는 모으기·연결하기·활용하기·함께하기·문서 보호이고 각 앵커로 간다", () => {
  assert.deepEqual(
    LANDING_NAV.map((item) => [item.label, item.href]),
    [
      ["모으기", "#capture"],
      ["연결하기", "#connect"],
      ["활용하기", "#discover"],
      ["함께하기", "#together"],
      ["문서 보호", "#data-handling"]
    ]
  );
});

test("메뉴가 가리키는 섹션의 제목은 메뉴 이름과 같다", () => {
  assert.deepEqual(
    LANDING_CHAPTERS.map((chapter) => landingNavLabel(`#${chapter.id}`)),
    ["모으기", "연결하기", "활용하기", "함께하기"]
  );
  assert.equal(landingNavLabel("#data-handling"), "문서 보호");
  const ui = read("LandingSections.tsx");
  assert.match(ui, /<h2 id=\{headingId\}[^>]*>\s*\{landingNavLabel\(`#\$\{chapter\.id\}`\)\}\s*<\/h2>/);
  // 기존 긴 제목은 제목 아래 한 줄 설명으로 남는다.
  assert.match(ui, /<p className=\{sections\["chapter-note"\]\}>\{chapter\.headline\}<\/p>/);
});

test("시연 자리는 올리기 → 편입·질의 → AI 편집·스킬 순서이고 제목과 설명이 있다", () => {
  assert.deepEqual(
    LANDING_DEMO_SLOTS.map((slot) => [slot.index, slot.id]),
    [
      ["01", "upload"],
      ["02", "connect-ask"],
      ["03", "edit-skill"]
    ]
  );
  for (const slot of LANDING_DEMO_SLOTS) {
    assert.ok(slot.title.length > 0, `${slot.id} 제목`);
    assert.ok(slot.body.length > 0, `${slot.id} 설명`);
  }
});

test("시연 영상은 틀 크기를 먼저 잡고, 재생 컨트롤은 네이티브가 아닌 버튼 하나만 쓴다", () => {
  const sectionsCss = read("LandingSections.module.css");
  assert.match(sectionsCss, /\.demo-video\s*\{[^}]*aspect-ratio:\s*var\(--video-ratio\);/s);
  // 영상에서 검은 띠를 잘라 냈으니 틀이 파일 비율과 같고, 틀 바탕이 다시 띠로 보이면 안 된다.
  const videoBlock = sectionsCss.match(/\.demo-video\s*\{[^}]*\}/s)[0];
  assert.match(videoBlock, /background:\s*var\(--lp-card\);/);
  assert.doesNotMatch(sectionsCss, /\.demo-video\s*\{\s*aspect-ratio:\s*2 \/ 1/);
  assert.doesNotMatch(sectionsCss, /object-fit:\s*contain/);
  const player = read("LandingVideo.tsx");
  for (const attribute of ["muted", "playsInline", "loop", 'preload="none"', "autoPlay="]) assert.ok(player.includes(attribute), attribute);
  assert.doesNotMatch(player, /<video[^>]*\bcontrols\b/s);
  // 영상마다 설명이 있고, 포스터는 지연 로드한다.
  assert.match(player, /aria-label=\{video\.label\}/);
  assert.match(player, /loading="lazy"/);
});

test("임시 화면과 예시 안내는 시연 흐름에서 지웠다", () => {
  assert.equal(listFiles(".tsx").includes("preview/DemoScreens.tsx"), false);
  assert.doesNotMatch(read("preview/Fragments.module.css"), /demo-frame|demo-composer|demo-graph/);
  assert.doesNotMatch(read("LandingSections.tsx"), /demo-note|화면은 예시/);
});

test("좁은 화면 메뉴는 헤더 메뉴와 같은 항목을 쓰고 Escape로 닫힌다", () => {
  const menu = read("LandingMobileMenu.tsx");
  assert.match(menu, /LANDING_NAV\.map/);
  assert.match(menu, /aria-expanded=\{isOpen\}/);
  assert.match(menu, /event\.key !== "Escape"/);
  assert.match(read("LandingPage.tsx"), /<LandingMobileMenu \/>/);
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
  // 02의 로그 이력과 롤백은 원래 문구처럼 별도 칩이다.
  assert.ok(LANDING_CHAPTERS[1].chips.includes("AI 로그 이력"));
  assert.ok(LANDING_CHAPTERS[1].chips.includes("롤백(History)"));
});

test("모든 기능 칩에 앱 SVG 아이콘이 있다", () => {
  const icons = read("LandingIcons.tsx");
  for (const chip of LANDING_CHAPTERS.flatMap((chapter) => chapter.chips)) {
    assert.ok(icons.includes(`"${chip}":`), `${chip} 아이콘`);
  }
  assert.doesNotMatch(icons, /lucide-react/);
});

test("장 화면은 큰 창 하나와 겹쳐 떠 있는 보조 패널 하나로 그린다", () => {
  const fragments = read("preview/FeatureFragments.tsx");
  for (const name of ["CaptureVisual", "ConnectVisual", "DiscoverVisual", "TogetherVisual"]) {
    const body = fragments.split(`export function ${name}`)[1]?.split("export function")[0] ?? "";
    assert.match(body, /<Stage/, `${name}는 Stage를 쓴다`);
    assert.match(body, /main=\{/);
    assert.match(body, /float=\{/);
  }
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
