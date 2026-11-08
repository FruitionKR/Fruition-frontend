import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../src/features/note-editing/ui/NoteEditor.tsx", import.meta.url), "utf8");
const update = source.match(/ctx\.update\(editorViewOptionsCtx, \(previous\) => \({[\s\S]*?\n      }\)\);/)[0];

function editorOptions(previous, locale = "ko") {
  const messages = JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/documents.json`, import.meta.url), "utf8"));
  const textRef = { current: { t: (key) => messages.editor[key] } };
  let options;
  runInNewContext(update, {
    ctx: { update: (_key, configure) => { options = configure(previous); } },
    editorViewOptionsCtx: {},
    textRef,
    guardPaste: () => false
  });
  return { options, textRef };
}

for (const [locale, label] of [["ko", "문서 본문"], ["en", "Document body"]]) {
  test(`${locale}: 본문 편집기에 제목과 구분되는 접근성 이름과 여러 줄 입력 의미를 제공한다`, () => {
    const { options } = editorOptions({}, locale);
    const attributes = typeof options.attributes === "function" ? options.attributes({}) : options.attributes;
    assert.equal(attributes?.["aria-label"], label);
    assert.equal(attributes?.["aria-multiline"], "true");
    assert.equal(attributes?.role, "textbox");
  });
}

test("기존 동적 편집기 속성과 붙여넣기 핸들러를 보존하고 최신 번역을 읽는다", () => {
  const state = {};
  const { options, textRef } = editorOptions({
    attributes: (received) => { assert.equal(received, state); return { class: "existing-editor", "data-test": "kept" }; },
    handlePaste: () => true
  });
  textRef.current.t = () => "Document body";
  assert.equal(options.attributes(state).class, "existing-editor");
  assert.equal(options.attributes(state)["data-test"], "kept");
  assert.equal(options.attributes(state)["aria-label"], "Document body");
  assert.equal(options.handlePaste({}, {}, {}), true);
});

test("기존 정적 편집기 속성도 보존한다", () => {
  const { options } = editorOptions({ attributes: { class: "existing-editor" } });
  assert.equal(options.attributes({}).class, "existing-editor");
});
