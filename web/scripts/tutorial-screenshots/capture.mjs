// 튜토리얼 단계 화면 캡처를 만든다. 사용법은 같은 폴더 README.md를 본다.
// 로컬 스택(기본 http://localhost:3000)에 로그인해 단계마다 화면을 열고, 누를 버튼에 주 색 테두리를 덧그린 뒤
// 관련 영역을 16:9로 잘라 public/tutorial/{locale}/<stepId>.webp(960×540)로 저장한다.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { createLabeler } from "./labels.mjs";
import { STEPS } from "./steps.mjs";

const BASE_URL = process.env.TUTORIAL_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.TUTORIAL_EMAIL;
const PASSWORD = process.env.TUTORIAL_PASSWORD;
const LOCALES = (process.env.TUTORIAL_LOCALES ?? "ko,en").split(",").map((value) => value.trim()).filter(Boolean);
const ONLY = new Set((process.env.TUTORIAL_ONLY ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const OUT_DIR = new URL("../../public/tutorial/", import.meta.url);

/** 저장 크기. src/features/tutorial/model/tutorialContent.ts의 TUTORIAL_IMAGE_SIZE와 같아야 한다. */
const OUTPUT = { width: 960, height: 540 };
const VIEWPORT = { width: 1440, height: 900 };
/** 2배 밀도로 찍어 기본 잘라내기(480×270)가 그대로 960×540이 된다. */
const DEVICE_SCALE = 2;
const MIN_CLIP_WIDTH = OUTPUT.width / DEVICE_SCALE;
const CLIP_PADDING = 28;
const MAX_BYTES = 150 * 1024;
const WEBP_QUALITIES = [80, 72, 64];

if (!EMAIL || !PASSWORD) {
  console.error("TUTORIAL_EMAIL과 TUTORIAL_PASSWORD 환경변수가 필요합니다.");
  process.exit(1);
}

// playwright는 앱 의존성이 아니라 캡처할 때만 따로 설치한다(README).
const { chromium } = await import("playwright").catch(() => {
  console.error("playwright가 없습니다. web/에서 `npm install --no-save playwright` 후 `npx playwright install chromium`을 실행하세요.");
  process.exit(1);
});
const { default: sharp } = await import("sharp");

/** 개발 표시·알림 카드처럼 단계와 상관없는 떠 있는 요소를 숨기고, 화면의 이메일 주소를 가린다. */
const PAGE_CLEANUP_CSS = `
  nextjs-portal, [data-nextjs-toast], [class*="DocumentProcessingNotifications_notice-stack"] { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; transition: none !important; animation-duration: 0s !important; }
`;

async function preparePage(page) {
  await page.addStyleTag({ content: PAGE_CLEANUP_CSS });
  await page.evaluate(() => {
    const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (email.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(email, "member@example.com");
    }
    for (const input of document.querySelectorAll("input")) {
      if (email.test(input.value)) input.value = input.value.replace(email, "member@example.com");
    }
  });
}

async function boxOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`화면에 보이지 않는 요소: ${locator}`);
  return box;
}

function unionBox(boxes) {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** focus 영역을 여백과 함께 담는 16:9 잘라내기. 화면 밖으로 나가지 않게 민다. */
function clipFor(focus, viewport, minWidth = MIN_CLIP_WIDTH) {
  const ratio = OUTPUT.width / OUTPUT.height;
  let width = Math.max(minWidth, focus.width + CLIP_PADDING * 2, (focus.height + CLIP_PADDING * 2) * ratio);
  width = Math.min(width, viewport.width, viewport.height * ratio);
  const height = width / ratio;
  const centerX = focus.x + focus.width / 2;
  const centerY = focus.y + focus.height / 2;
  const x = Math.min(Math.max(centerX - width / 2, 0), viewport.width - width);
  const y = Math.min(Math.max(centerY - height / 2, 0), viewport.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** 누를 버튼 둘레에 주 색 테두리를 덧그린다. 캡처에만 쓰는 오버레이라 클릭을 막지 않는다. */
async function drawHighlights(page, boxes) {
  await page.evaluate((items) => {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#3182f6";
    for (const box of items) {
      const ring = document.createElement("div");
      ring.setAttribute("data-tutorial-highlight", "");
      Object.assign(ring.style, {
        position: "fixed",
        left: `${box.x - 5}px`,
        top: `${box.y - 5}px`,
        width: `${box.width + 10}px`,
        height: `${box.height + 10}px`,
        border: `3px solid ${color}`,
        borderRadius: "12px",
        boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)`,
        pointerEvents: "none",
        zIndex: "2147483647",
        boxSizing: "border-box"
      });
      document.body.appendChild(ring);
    }
  }, boxes);
}

async function encode(png) {
  const resized = sharp(png).resize(OUTPUT.width, OUTPUT.height, { fit: "fill" });
  for (const quality of WEBP_QUALITIES) {
    const webp = await resized.clone().webp({ quality, effort: 6 }).toBuffer();
    if (webp.length <= MAX_BYTES) return webp;
  }
  throw new Error(`${MAX_BYTES / 1024}KB 이하로 줄이지 못했습니다.`);
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="password"]').press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function captureLocale(browser, locale) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE, colorScheme: "light", locale: locale === "ko" ? "ko-KR" : "en-US" });
  // 직접 고른 언어(fruition.locale)는 계정에도 저장되므로 쓰지 않는다. 자동 판정 쿠키만 바꿔 이 브라우저 화면만 바꾼다(docs/i18n.md).
  await context.addCookies([{ name: "fruition.locale-auto", value: locale, url: BASE_URL }]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await login(page);

  const label = createLabeler(locale);
  const dir = new URL(`${locale}/`, OUT_DIR);
  mkdirSync(dir, { recursive: true });
  const helpers = createHelpers(page, label);
  const results = [];

  for (const step of STEPS) {
    if (ONLY.size && !ONLY.has(step.id)) continue;
    try {
      // 설정 화면처럼 줄이 넓은 화면은 좁은 창으로 열어 글자가 덜 축소되게 한다.
      const viewport = step.viewport ?? VIEWPORT;
      await page.setViewportSize(viewport);
      const shot = await step.run(helpers, locale);
      await preparePage(page);
      const elementBoxes = await Promise.all((shot.highlight ?? []).map(boxOf));
      // group이면 여러 요소를 테두리 하나로 묶는다(트리의 원본·변환본 두 줄처럼 한 덩어리로 보여 줄 때).
      const highlightBoxes = shot.group && elementBoxes.length ? [unionBox(elementBoxes)] : elementBoxes;
      const focusBoxes = [...highlightBoxes, ...(await Promise.all((shot.focus ?? []).map(boxOf)))];
      const clip = shot.clip ?? clipFor(unionBox(focusBoxes), viewport, shot.minWidth);
      await drawHighlights(page, highlightBoxes);
      const png = await page.screenshot({ clip });
      const webp = await encode(png);
      const file = new URL(`${step.id}.webp`, dir);
      writeFileSync(file, webp);
      results.push({ id: step.id, bytes: statSync(file).size });
      console.log(`${locale} ${step.id}: ${(webp.length / 1024).toFixed(1)}KB`);
    } catch (error) {
      console.error(`${locale} ${step.id}: 실패 - ${error.message.split("\n")[0]}`);
      await page.screenshot({ path: `tutorial-shot-failed-${locale}-${step.id}.png` }).catch(() => {});
      results.push({ id: step.id, error: true });
    } finally {
      if (step.cleanup) await step.cleanup(helpers).catch(() => {});
      await helpers.reset();
    }
  }
  await context.close();
  return results;
}

/** 단계 정의에서 쓰는 공용 동작 */
function createHelpers(page, label) {
  const button = (koText, values, keyHint) => page.getByRole("button", { name: label(koText, values, keyHint), exact: true });
  return {
    page,
    label,
    button,
    text: (koText, values) => page.getByText(label(koText, values), { exact: true }),
    menuItem: (koText) => page.getByRole("menuitem", { name: label(koText), exact: true }),
    /** 홈(문서 화면)을 새로 열고 사이드바 트리가 그려질 때까지 기다린다. */
    async home(documentName) {
      await page.goto(`${BASE_URL}/home`);
      await button("홈", {}, "rail").waitFor();
      await page.getByText(label("새 노트 추가"), { exact: true }).waitFor();
      if (documentName) {
        await page.getByText(documentName, { exact: true }).first().click();
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(800);
    },
    /** 왼쪽 레일 버튼. 같은 문구의 다른 화면 문구와 섞이지 않게 레일 메시지 키에서 찾는다. */
    async rail(koText) {
      await button(koText, {}, "rail").click();
      await page.waitForTimeout(1500);
    },
    async settings(menuKoText) {
      await button("설정", {}, "rail").click();
      await button(menuKoText).first().click();
      await page.waitForTimeout(1500);
    },
    /** 단계 사이에 열린 메뉴·창과 덧그린 테두리를 치운다. */
    async reset() {
      await page.evaluate(() => document.querySelectorAll("[data-tutorial-highlight]").forEach((node) => node.remove())).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
    }
  };
}

const browser = await chromium.launch();
const summary = {};
try {
  for (const locale of LOCALES) summary[locale] = await captureLocale(browser, locale);
} finally {
  await browser.close();
}

const failed = Object.entries(summary).flatMap(([locale, results]) => results.filter((result) => result.error).map((result) => `${locale}/${result.id}`));
const total = Object.values(summary).flat().reduce((sum, result) => sum + (result.bytes ?? 0), 0);
console.log(`\n저장 ${Object.values(summary).flat().filter((result) => result.bytes).length}개, ${(total / 1024).toFixed(0)}KB`);
if (failed.length) {
  console.error(`실패: ${failed.join(", ")}`);
  process.exitCode = 1;
}
