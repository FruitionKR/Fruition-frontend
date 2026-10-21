import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
const { buildTreeConversionBadges, getTreeConversionBadge } = await import("../src/widgets/document-sidebar/model/treeConversionBadge.ts");

const pdf = (extra = {}) => ({ id: "pdf", filename: "회의자료.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed", ...extra });
const md = (extra = {}) => ({ id: "md", filename: "회의자료.md", mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", source_document_id: "pdf", pipeline_run_id: "convert:1", ...extra });

test("변환을 마친 PDF는 PDF 배지에 체크를 붙이고 변환본 이름을 설명으로 둔다", () => {
  assert.deepEqual(getTreeConversionBadge(pdf(), [pdf(), md()]), {
    label: "PDF",
    isConverted: true,
    description: "Markdown으로 변환됨: 회의자료.md"
  });
});

test("변환본 MD는 PDF→MD 배지와 원본 이름을 설명으로 둔다", () => {
  assert.deepEqual(getTreeConversionBadge(md(), [pdf(), md()]), {
    label: "PDF→MD",
    isConverted: false,
    description: "PDF에서 변환: 회의자료.pdf"
  });
});

test("이름이 달라도 source_document_id 관계로 짝을 찾는다", () => {
  const renamed = md({ filename: "정리본.md" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), renamed])?.description, "Markdown으로 변환됨: 정리본.md");
});

test("원본이 목록에 없으면 변환본은 일반 문구만 둔다", () => {
  assert.equal(getTreeConversionBadge(md(), [md()])?.description, "PDF에서 변환한 문서");
});

test("변환본이 없거나 변환 중·실패이면 PDF에 체크를 붙이지 않는다", () => {
  assert.equal(getTreeConversionBadge(pdf(), [pdf()]), null);
  const converting = md({ status: "processing" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), converting]), null);
  const failed = md({ status: "failed" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), failed]), null);
  // 변환 중인 변환본도 MD 행은 PDF→MD로 보인다.
  assert.equal(getTreeConversionBadge(converting, [pdf(), converting])?.label, "PDF→MD");
});

test("재변환 중이면 앞선 변환본이 있어도 체크를 붙이지 않는다", () => {
  const rerun = md({ id: "md2", status: "processing", pipeline_run_id: "convert:2" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), md(), rerun]), null);
});

test("관계가 없는 일반 문서는 배지를 바꾸지 않는다", () => {
  const plain = md({ id: "plain", source_document_id: undefined });
  assert.equal(getTreeConversionBadge(plain, [plain, pdf()]), null);
  const txt = { id: "txt", filename: "메모.txt", mime_type: "text/plain", document_role: "ORIGINAL", status: "completed" };
  assert.equal(getTreeConversionBadge(txt, [txt]), null);
});

test("문서 id별 맵에는 관계가 있는 문서만 들어간다", () => {
  const plain = md({ id: "plain", source_document_id: undefined });
  const badges = buildTreeConversionBadges([pdf(), md(), plain]);
  assert.deepEqual([...badges.keys()].sort(), ["md", "pdf"]);
});
