import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useTranslations } from "./fakeNextIntl.mjs";

const content = await import("../src/features/tutorial/model/tutorialContent.ts");
const { TUTORIAL_IMAGE_SIZE, TUTORIAL_SECTIONS, tutorialImageSrc } = content;

// 단계 캡처는 public/tutorial/{locale}/<stepId>.webp(scripts/tutorial-screenshots/로 만든다).
const LOCALES = ["ko", "en"];
const IMAGE_DIR = (locale) => new URL(`../public/tutorial/${locale}/`, import.meta.url);
const MAX_IMAGE_BYTES = 150 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

const allSteps = () => TUTORIAL_SECTIONS.flatMap((section) => section.steps);
const imageSteps = () => allSteps().filter((step) => step.image !== undefined);

/** WebP(RIFF) 머리에서 가로·세로 픽셀을 읽는다. VP8·VP8L·VP8X를 모두 읽는다. */
function webpSize(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  throw new Error(`알 수 없는 WebP 청크: ${chunk}`);
}

test("캡처 파일 이름은 단계 id.webp다", () => {
  assert.ok(imageSteps().length > 0, "캡처가 있는 단계가 있다");
  for (const step of imageSteps()) assert.equal(step.image, `${step.id}.webp`, step.id);
});

test("캡처 주소는 언어 폴더에 파일 이름을 붙인다", () => {
  assert.equal(tutorialImageSrc("ko", "write-note.webp"), "/tutorial/ko/write-note.webp");
  assert.equal(tutorialImageSrc("en", "write-note.webp"), "/tutorial/en/write-note.webp");
});

for (const locale of LOCALES) {
  test(`${locale}: image를 지정한 모든 단계의 캡처가 있고 크기가 같다`, () => {
    for (const step of imageSteps()) {
      const file = new URL(step.image, IMAGE_DIR(locale));
      assert.ok(existsSync(file), `${locale}/${step.image}`);
      assert.deepEqual(webpSize(readFileSync(file)), { ...TUTORIAL_IMAGE_SIZE }, `${locale}/${step.image}`);
    }
  });

  test(`${locale}: 캡처는 장마다 150KB 이하이고 단계에 없는 파일이 없다`, () => {
    const used = new Set(imageSteps().map((step) => step.image));
    for (const name of readdirSync(IMAGE_DIR(locale))) {
      assert.ok(used.has(name), `단계에서 쓰지 않는 파일: ${locale}/${name}`);
      assert.ok(statSync(new URL(name, IMAGE_DIR(locale))).size <= MAX_IMAGE_BYTES, `${locale}/${name}`);
    }
  });
}

test("캡처 전체 용량이 6MB 이하다", () => {
  const total = LOCALES.flatMap((locale) => readdirSync(IMAGE_DIR(locale)).map((name) => statSync(new URL(name, IMAGE_DIR(locale))).size))
    .reduce((sum, size) => sum + size, 0);
  assert.ok(total <= MAX_TOTAL_BYTES, `${total} bytes`);
});

// --- 화면 렌더: 캡처가 있는 단계는 img, 없는 단계는 아이콘 ---

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/tutorial/ui/TutorialDialog.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;

function renderAt(stepId, locale = "ko") {
  const sectionIndex = TUTORIAL_SECTIONS.findIndex((section) => section.steps.some((step) => step.id === stepId));
  const section = TUTORIAL_SECTIONS[sectionIndex];
  const stepIndex = section.steps.findIndex((step) => step.id === stepId);
  const tutorial = {
    position: { sectionIndex, stepIndex },
    section,
    step: section.steps[stepIndex],
    progress: { current: 1, total: allSteps().length },
    isFirst: false,
    isLast: false
  };
  const cssModule = { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) };
  const aliases = {
    "next-intl": { useTranslations, useLocale: () => locale },
    "@/shared/lib/classNames": { cx: (...values) => values.filter(Boolean).join(" ") },
    "@/shared/ui/modal/CenteredModal": { CenteredModal: ({ children }) => React.createElement("div", null, children) },
    "@/shared/ui/modal/CenteredModal.module.css": cssModule,
    "@/shared/ui/SvgIcon": { plusIcon: "plus", SvgIcon: () => null },
    "../model/tutorialContent": content,
    "../model/useTutorial": { useTutorialProgress: () => tutorial },
    "./TutorialIcons": { TutorialIconGlyph: ({ name }) => React.createElement("svg", { "data-icon": name }) },
    "./TutorialDialog.module.css": cssModule
  };
  const exports = {};
  runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id) });
  return renderToStaticMarkup(React.createElement(exports.TutorialDialog, { onClose: () => {} }));
}

const tc = useTranslations("tutorialContent");

test("캡처가 있는 단계는 크기를 지정한 lazy 이미지를 단계 제목을 alt로 그리고 아이콘은 그리지 않는다", () => {
  const step = imageSteps()[0];
  const html = renderAt(step.id, "en");
  assert.match(html, new RegExp(`<img[^>]*src="/tutorial/en/${step.id}\\.webp"`));
  assert.match(html, new RegExp(`<img[^>]*alt="${tc(`steps.${step.id}.title`)}"`));
  assert.match(html, /<img[^>]*width="960"[^>]*height="540"/);
  assert.match(html, /<img[^>]*loading="lazy"/);
  assert.match(html, /class="step has-image"/);
  assert.doesNotMatch(html, /class="step-icon"/);
});

test("캡처가 없는 단계는 이미지 없이 아이콘만 그린다", () => {
  const step = allSteps().find((item) => item.image === undefined);
  assert.ok(step, "캡처가 없는 단계가 있다");
  const html = renderAt(step.id);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /class="step-icon"/);
  assert.match(html, /class="step"/);
});
