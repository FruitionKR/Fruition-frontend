import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const { LANDING_DEMO_SLOTS, LANDING_FAQ, LANDING_FIRST_DEMO_ANCHOR, LANDING_NAV, LANDING_TOGETHER, landingNavLabel } = await import("../src/views/landing/model/landingContent.ts");

const UI_DIR = new URL("../src/views/landing/ui/", import.meta.url);
const read = (name) => readFileSync(new URL(name, UI_DIR), "utf8");
const listFiles = (extension) => [
  ...readdirSync(UI_DIR).filter((name) => name.endsWith(extension)),
  ...readdirSync(new URL("preview/", UI_DIR))
    .filter((name) => name.endsWith(extension))
    .map((name) => `preview/${name}`)
];

test("헤더 메뉴는 문서 보호만 남고 그 섹션을 가리킨다", () => {
  assert.deepEqual(LANDING_NAV.map((item) => [item.label, item.href]), [["문서 보호", "#data-handling"]]);
  assert.equal(landingNavLabel("#data-handling"), "문서 보호");
});

test("첫 화면 다음에 바로 영상이 오고, 장 카드와 영상이 다루는 소개 장은 없다", () => {
  const page = read("LandingPage.tsx");
  assert.match(page, /<LandingHero \/>\s*<LandingDemo \/>\s*<LandingTogether \/>\s*<LandingDataHandling \/>\s*<LandingFaq \/>\s*<LandingStart \/>/);
  const ui = listFiles(".tsx").map(read).join("\n");
  assert.doesNotMatch(ui, /ChapterCards|LandingChapters|CaptureVisual|ConnectVisual|DiscoverVisual|CHAPTER_ICONS/);
  assert.doesNotMatch(listFiles(".css").map(read).join("\n"), /chapter-card|lp-tint-(capture|connect|discover)/);
});

test("페이지 안 앵커는 모두 실제 대상이 있다", () => {
  const ui = listFiles(".tsx").map(read).join("\n");
  const links = [...ui.matchAll(/href="(#[a-z-]+)"/g)].map((match) => match[1]);
  for (const href of links) assert.ok(ui.includes(`id="${href.slice(1)}"`), href);
  assert.doesNotMatch(ui, /#(capture|connect|discover|chapters)\b/);
  // 기능 둘러보기와 건너뛰기 링크는 첫 영상 묶음으로 간다.
  assert.equal(LANDING_FIRST_DEMO_ANCHOR, `#demo-${LANDING_DEMO_SLOTS[0].id}`);
  const page = read("LandingPage.tsx");
  assert.equal(page.match(/href=\{LANDING_FIRST_DEMO_ANCHOR\}/g)?.length, 2);
  assert.match(read("LandingSections.tsx"), /id=\{`demo-\$\{slot\.id\}`\}/);
});

test("영상이 다루지 않는 기능은 사라지지 않고 원래 칩 문구로 남는다", () => {
  const chips = new Set([...LANDING_DEMO_SLOTS.flatMap((slot) => slot.chips), ...LANDING_TOGETHER.chips]);
  for (const chip of ["회의 받아쓰기 및 AI 회의록", "폴더 관리", "문서와 채팅 위키 편입(Ingest)", "AI 로그 이력", "롤백(History)", "팀 워크스페이스", "멤버 초대", "권한 관리", "안전한 공동 편집", "팀 스킬 공유"]) {
    assert.ok(chips.has(chip), chip);
  }
  assert.equal(LANDING_TOGETHER.title, "함께하기");
  assert.equal(LANDING_TOGETHER.english, "BUILD TOGETHER");
  assert.match(LANDING_TOGETHER.body, /자동 병합·버전 기록/);
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

test("영상은 CSS sticky와 칸 높이로만 머무르고 스크롤을 가로채지 않는다", () => {
  const css = read("LandingSections.module.css");
  assert.match(read("LandingPage.module.css"), /--lp-video-hold:\s*60svh;/);
  // 머무는 거리는 sticky가 움직일 칸(같은 부모 안의 빈 칸)이어야 한다. padding은 sticky 범위에 들지 않는다.
  assert.match(css, /\.demo-step::after\s*\{[^}]*height:\s*var\(--lp-video-hold\);/s);
  assert.match(css, /\.demo-step-figure\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--demo-pin-top\);/s);
  assert.doesNotMatch(css, /scroll-snap/);
  // 왼쪽 묶음 설명과 같은 높이에 멈춘다.
  assert.match(css, /\.demo-copy\s*\{[^}]*top:\s*var\(--demo-pin-top\);/s);
  const ui = listFiles(".tsx").map(read).join("\n");
  assert.doesNotMatch(ui, /addEventListener\("(wheel|scroll|touchmove)"|onWheel|scrollTo\(/);
});

test("고정은 움직임 줄이기가 아니고 틀이 화면에 들어올 때만 켠다", () => {
  const css = read("LandingSections.module.css");
  const block = css.split("/* 영상 고정 조건 */")[1] ?? "";
  const media = block.match(/@media([^{]+)\{/)?.[1] ?? "";
  const conditions = media.split(",");
  assert.equal(conditions.length, 2);
  for (const condition of conditions) assert.match(condition, /prefers-reduced-motion: no-preference/);
  assert.match(conditions[0], /min-width: 1024px/);
  assert.match(conditions[0], /min-height: 720px/);
  assert.match(conditions[1], /max-width: 1023px/);
  assert.match(conditions[1], /max-aspect-ratio: 1\s*\/\s*1/);
  assert.match(conditions[1], /min-height: 540px/);
  assert.match(block, /html:not\(\[data-reduce-motion="true"\]\)/);
});

test("재생 버튼은 화면 진입 여부로 바뀌지 않는다(들어오는 동안 큰 버튼이 깜빡이지 않게)", () => {
  const player = read("LandingVideo.tsx");
  assert.match(player, /const wantsPlayInView = !hasFailed && shouldPlayVideo\(\{ isInView: true,/);
  assert.match(player, /const wantsPlay = wantsPlayInView && isInView;/);
  assert.match(player, /videoControlState\(\{ wantsPlay: wantsPlayInView, hasFailed \}\)/);
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

test("모든 기능 칩에 앱 SVG 아이콘이 있다", () => {
  const icons = read("LandingIcons.tsx");
  for (const chip of [...LANDING_DEMO_SLOTS.flatMap((slot) => slot.chips), ...LANDING_TOGETHER.chips]) {
    assert.ok(icons.includes(`"${chip}":`), `${chip} 아이콘`);
  }
  assert.doesNotMatch(icons, /lucide-react/);
});

test("함께하기 화면은 큰 창 하나와 겹쳐 떠 있는 보조 패널 하나로 그린다", () => {
  const body = read("preview/FeatureFragments.tsx").split("export function TogetherVisual")[1] ?? "";
  assert.match(body, /<Stage/);
  assert.match(body, /main=\{/);
  assert.match(body, /float=\{/);
});

test("충돌을 사람이 직접 해결한다는 문구를 쓰지 않는다(자동 병합)", () => {
  const copy = JSON.stringify([LANDING_TOGETHER, LANDING_FAQ]) + listFiles(".tsx").map(read).join("\n");
  assert.doesNotMatch(copy, /충돌 기록|충돌을 확인|충돌 확인|합칩니다/);
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
