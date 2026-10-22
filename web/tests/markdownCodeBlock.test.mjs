import assert from "node:assert/strict";
import test from "node:test";

const { codeBlockLanguage, codeBlockCopyText, codeBlockLineCount, hastText, PLAIN_CODE_LANGUAGE } = await import(
  "../src/shared/lib/markdown/codeBlock.ts"
);

test("language- 클래스에서 펜스에 쓴 언어 이름을 그대로 꺼낸다", () => {
  assert.equal(codeBlockLanguage(["language-js"]), "js");
  assert.equal(codeBlockLanguage(["foo", "language-TypeScript"]), "TypeScript");
  assert.equal(codeBlockLanguage("hljs language-python"), "python");
});

test("언어가 없으면 편집기처럼 Text를 보여 준다", () => {
  assert.equal(PLAIN_CODE_LANGUAGE, "Text");
  assert.equal(codeBlockLanguage(undefined), "Text");
  assert.equal(codeBlockLanguage([]), "Text");
  assert.equal(codeBlockLanguage("language-"), "Text");
  assert.equal(codeBlockLanguage(42), "Text");
});

test("hast 코드 노드의 글자를 순서대로 이어 붙인다", () => {
  const node = {
    type: "element",
    children: [
      { type: "text", value: "const a = 1;\n" },
      { type: "element", children: [{ type: "text", value: "a += 1;" }] },
      { type: "text", value: "\n" }
    ]
  };
  assert.equal(hastText(node), "const a = 1;\na += 1;\n");
  assert.equal(hastText(undefined), "");
});

test("복사 텍스트는 끝 줄바꿈 하나만 떼고 줄 번호 없이 원문을 유지한다", () => {
  assert.equal(codeBlockCopyText("a\n  b\n"), "a\n  b");
  assert.equal(codeBlockCopyText("a\n\n"), "a\n");
  assert.equal(codeBlockCopyText("a"), "a");
  assert.equal(codeBlockCopyText(""), "");
});

test("줄 수는 복사 텍스트의 줄 수이며 빈 블록도 1줄이다", () => {
  assert.equal(codeBlockLineCount("a\nb\nc"), 3);
  assert.equal(codeBlockLineCount("a\n"), 2);
  assert.equal(codeBlockLineCount(""), 1);
});
