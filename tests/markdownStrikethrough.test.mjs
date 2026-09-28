import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { DOUBLE_TILDE_STRIKETHROUGH_PATTERN } from "../src/features/note-editing/model/markdownStrikethrough.ts";

test("에디터 입력 규칙은 ~~만 취소선으로 인식한다", () => {
  assert.equal(DOUBLE_TILDE_STRIKETHROUGH_PATTERN.test("5~7초 정도, 3~4개~"), false);
  assert.equal(DOUBLE_TILDE_STRIKETHROUGH_PATTERN.test("소요 시간은 5~7초~ 입니다"), false);
  assert.equal(DOUBLE_TILDE_STRIKETHROUGH_PATTERN.test("~~삭제됨~~"), true);
});

test("뷰어 파서는 singleTilde=false로 범위 표기를 텍스트로 둔다", () => {
  const parse = (options) => unified().use(remarkParse).use(remarkGfm, options).parse("5~7초 대기, 3~4개 처리 ~~삭제~~");
  const types = (tree) => tree.children[0].children.map((node) => node.type);
  assert.deepEqual(types(parse({ singleTilde: false })), ["text", "delete"]);
  assert.ok(types(parse({})).filter((type) => type === "delete").length > 1);
});
