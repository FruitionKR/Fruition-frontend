import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HEADING_INPUT_PATTERN, MAX_EDITOR_HEADING_LEVEL, resolveHeadingInputLevel } from "../src/features/note-editing/model/markdownHeading.ts";

test("제목 입력 규칙은 h4보다 작은 제목을 만들지 않는다", () => {
  assert.equal(MAX_EDITOR_HEADING_LEVEL, 4);
  assert.equal(resolveHeadingInputLevel(1, null), 1);
  assert.equal(resolveHeadingInputLevel(4, null), 4);
  assert.equal(resolveHeadingInputLevel(5, null), 4);
  assert.equal(resolveHeadingInputLevel(6, null), 4);
  // 제목 안에서 `#`을 입력하면 현재 단계에 더하되 h4에서 멈춘다.
  assert.equal(resolveHeadingInputLevel(1, 2), 3);
  assert.equal(resolveHeadingInputLevel(2, 3), 4);
});

test("제목 입력 패턴은 `#` 묶음 뒤 공백을 잡는다", () => {
  assert.equal(HEADING_INPUT_PATTERN.exec("##### ")?.[1], "#####");
  assert.equal(HEADING_INPUT_PATTERN.test("#제목 "), false);
});

test("바꿔 끼우는 commonmark 기본 제목 규칙의 패턴이 그대로다", async () => {
  // 패턴이 바뀌면 기본 규칙이 걸러지지 않아 h5/h6가 다시 만들어진다.
  const [preset, source] = await Promise.all([
    readFile(new URL("../node_modules/@milkdown/preset-commonmark/lib/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/note-editing/model/markdownHeading.ts", import.meta.url), "utf8")
  ]);
  assert.match(preset, /textblockTypeInputRule\(\/\^\(\?<hashes>#\+\)\\s\$\//);
  assert.match(source, /COMMONMARK_HEADING_PATTERN_SOURCE = "\^\(\?<hashes>#\+\)\\\\s\$"/);
});

test("슬래시 메뉴에서 제목 5·6을 뺀다", async () => {
  const source = await readFile(new URL("../src/features/note-editing/ui/NoteEditor.tsx", import.meta.url), "utf8");
  assert.match(source, /h5: null,\s*h6: null,/);
  assert.match(source, /\.use\(cappedHeadingInputRule\)/);
  assert.match(source, /disableSmallHeadingShortcuts\(ctx\)/);
});
