import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const {
  hasMarkdownExtension, hasPdfExtension, hasTextExtension,
  isPdfDocument, isMarkdownDocument, isMarkdownTreeItem, isPdfTreeItem, isDocumentInFlight,
  SUPPORTED_UPLOAD_EXTENSIONS
} = await import("../src/entities/document/lib/documentKind.ts");

const doc = (overrides) => ({ id: "d", filename: "a.md", mime_type: "text/markdown", document_role: "EDITABLE", ...overrides });

test("확장자 판별은 대소문자를 무시한다", () => {
  assert.equal(hasMarkdownExtension("Note.MD"), true);
  assert.equal(hasMarkdownExtension("note.markdown"), true);
  assert.equal(hasMarkdownExtension("note.md.bak"), false);
  assert.equal(hasPdfExtension("paper.PDF"), true);
  assert.equal(hasPdfExtension("paper.pdfx"), false);
  assert.equal(hasTextExtension("memo.txt"), true);
  assert.equal(hasTextExtension("memo.text"), false);
});

test("업로드 허용 확장자는 .markdown을 포함하지 않는다", () => {
  assert.deepEqual([...SUPPORTED_UPLOAD_EXTENSIONS], [".pdf", ".md", ".txt"]);
});

test("PDF 문서는 mime 또는 확장자로 판별한다", () => {
  assert.equal(isPdfDocument(doc({ filename: "x.bin", mime_type: "application/pdf" })), true);
  assert.equal(isPdfDocument(doc({ filename: "x.pdf", mime_type: "application/octet-stream" })), true);
  assert.equal(isPdfDocument(doc({ filename: "x.md" })), false);
});

test("Markdown 문서는 EDITABLE 역할이어야 한다", () => {
  assert.equal(isMarkdownDocument(doc({})), true);
  assert.equal(isMarkdownDocument(doc({ mime_type: "text/plain", filename: "n.markdown" })), true);
  assert.equal(isMarkdownDocument(doc({ document_role: "SOURCE" })), false);
  assert.equal(isMarkdownDocument(doc({ mime_type: "text/plain", filename: "n.txt" })), false);
});

test("트리 항목의 Markdown·PDF 판별", () => {
  assert.equal(isMarkdownTreeItem({ id: "1", label: "x", type: "file", mimeType: "text/markdown" }), true);
  assert.equal(isMarkdownTreeItem({ id: "1", label: "x.md", type: "file" }), true);
  assert.equal(isMarkdownTreeItem({ id: "1", label: "x.txt", type: "file" }), false);
  assert.equal(isPdfTreeItem({ id: "1", label: "x", type: "file", mimeType: "application/pdf" }), true);
  assert.equal(isPdfTreeItem({ id: "1", label: "x.pdf", type: "file" }), true);
  assert.equal(isPdfTreeItem({ id: "1", label: "x.md", type: "file" }), false);
});

test("uploaded·processing만 진행 중 상태다", () => {
  assert.equal(isDocumentInFlight("uploaded"), true);
  assert.equal(isDocumentInFlight("processing"), true);
  assert.equal(isDocumentInFlight("completed"), false);
  assert.equal(isDocumentInFlight("failed"), false);
  assert.equal(isDocumentInFlight(undefined), false);
});
