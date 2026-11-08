import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { TUTORIAL_SECTIONS } = await import("../src/features/tutorial/model/tutorialContent.ts");

// 튜토리얼 구조는 TS 모델에, 문구는 tutorialContent 네임스페이스 메시지에 있다.
const messages = (locale) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/tutorialContent.json`, import.meta.url), "utf8"));
const LOCALES = ["ko", "en"];
const SECTION_RANGE = [8, 12];
const STEP_RANGE = [2, 5];
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ICONS = new Set(["start", "document", "upload", "pdf", "wiki", "graph", "chat", "agent", "skill", "meeting", "import", "settings", "language", "log"]);

const allSteps = () => TUTORIAL_SECTIONS.flatMap((section) => section.steps);

function flatten(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

test("섹션 수와 섹션마다의 단계 수가 범위 안이다", () => {
  assert.ok(TUTORIAL_SECTIONS.length >= SECTION_RANGE[0] && TUTORIAL_SECTIONS.length <= SECTION_RANGE[1], `섹션 ${TUTORIAL_SECTIONS.length}개`);
  for (const section of TUTORIAL_SECTIONS) {
    assert.ok(section.steps.length >= STEP_RANGE[0] && section.steps.length <= STEP_RANGE[1], `${section.id}: 단계 ${section.steps.length}개`);
  }
});

test("섹션·단계 id는 kebab-case이고 전체에서 겹치지 않는다", () => {
  const ids = [...TUTORIAL_SECTIONS.map((section) => section.id), ...allSteps().map((step) => step.id)];
  for (const id of ids) assert.match(id, KEBAB_CASE, id);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], "겹치는 id");
});

test("아이콘은 정해진 종류만 쓴다", () => {
  for (const section of TUTORIAL_SECTIONS) assert.ok(ICONS.has(section.icon), `${section.id}: ${section.icon}`);
  for (const step of allSteps()) if (step.icon !== undefined) assert.ok(ICONS.has(step.icon), `${step.id}: ${step.icon}`);
});

for (const locale of LOCALES) {
  test(`${locale}: 모든 섹션·단계에 비어 있지 않은 문구가 있다`, () => {
    const { sections, steps } = messages(locale);
    for (const section of TUTORIAL_SECTIONS) {
      for (const field of ["title", "summary"]) assert.ok(sections[section.id]?.[field]?.trim(), `sections.${section.id}.${field}`);
    }
    for (const step of allSteps()) {
      for (const field of ["title", "body"]) assert.ok(steps[step.id]?.[field]?.trim(), `steps.${step.id}.${field}`);
    }
  });

  test(`${locale}: 메시지에 모델에 없는 섹션·단계가 없다`, () => {
    const { sections, steps } = messages(locale);
    assert.deepEqual(Object.keys(sections).sort(), TUTORIAL_SECTIONS.map((section) => section.id).sort());
    assert.deepEqual(Object.keys(steps).sort(), allSteps().map((step) => step.id).sort());
  });

  test(`${locale}: 문구에 ICU 특수문자·태그가 없다`, () => {
    for (const key of flatten(messages(locale))) {
      const text = key.split(".").reduce((value, part) => value[part], messages(locale));
      assert.doesNotMatch(text, /[{}<>]/, key);
      // 작은따옴표 바로 뒤에 ICU 특수문자가 오면 인용으로 읽혀 글자가 사라진다.
      assert.doesNotMatch(text, /'[{}'#|]/, key);
    }
  });
}

test("ko·en 메시지 키가 서로 같다", () => {
  const [ko, en] = LOCALES.map((locale) => flatten(messages(locale)).sort());
  assert.deepEqual(en, ko);
});

test("en 문구에 한글이 없다", () => {
  const en = messages("en");
  for (const key of flatten(en)) {
    const text = key.split(".").reduce((value, part) => value[part], en);
    assert.doesNotMatch(text, /[ᄀ-ᇿ㄰-㆏가-힣]/, key);
  }
});

test("ko 단계 본문은 해요체 2~4문장이다", () => {
  const { steps } = messages("ko");
  for (const step of allSteps()) {
    const sentences = steps[step.id].body.split(/(?<=[.?!])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 2 && sentences.length <= 4, `${step.id}: ${sentences.length}문장`);
    assert.match(steps[step.id].body, /요\.$/, `${step.id}: 해요체로 끝난다`);
  }
});
