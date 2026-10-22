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

test("변환을 마친 원본 PDF 배지는 변환된 노트로 연결한다", () => {
  assert.deepEqual(getTreeConversionBadge(pdf(), [pdf(), md()]), {
    label: "원본 PDF",
    isConverted: true,
    description: "업로드한 원본 PDF입니다. 클릭하면 변환본을 엽니다.\n[회의자료.md]",
    relatedDocumentId: "md"
  });
});

test("변환된 노트 배지는 원본 PDF로 연결한다", () => {
  assert.deepEqual(getTreeConversionBadge(md(), [pdf(), md()]), {
    label: "변환본",
    isConverted: false,
    description: "PDF에서 만든 Markdown 문서입니다. 클릭하면 원본 PDF를 엽니다.\n[회의자료.pdf]",
    relatedDocumentId: "pdf"
  });
});

test("이름이 달라도 source_document_id 관계로 짝을 찾는다", () => {
  const renamed = md({ filename: "정리본.md" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), renamed])?.description, "업로드한 원본 PDF입니다. 클릭하면 변환본을 엽니다.\n[정리본.md]");
});

test("원본이 목록에 없으면 변환본은 일반 문구만 둔다", () => {
  const badge = getTreeConversionBadge(md(), [md()]);
  assert.equal(badge?.description, "PDF에서 만든 Markdown 문서입니다. 원본 PDF를 찾을 수 없습니다.");
  assert.equal(badge?.relatedDocumentId, null);
});

test("변환본이 없거나 변환 중·실패이면 PDF를 연결하지 않는다", () => {
  assert.equal(getTreeConversionBadge(pdf(), [pdf()]), null);
  const converting = md({ status: "processing" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), converting]), null);
  const failed = md({ status: "failed" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), failed]), null);
  // 변환 중인 노트에서도 원본 PDF는 확인할 수 있다.
  assert.equal(getTreeConversionBadge(converting, [pdf(), converting])?.relatedDocumentId, "pdf");
});

test("재변환 중이면 앞선 변환본이 있어도 완료된 결과로 연결하지 않는다", () => {
  const rerun = md({ id: "md2", status: "processing", pipeline_run_id: "convert:2" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), md(), rerun]), null);
});

test("재변환 결과가 여러 개면 목록 순서나 수정 시간이 아닌 생성 시각 기준으로 최신 노트에 연결한다", () => {
  const old = md({ id: "old", uploaded_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" });
  const latest = md({ id: "latest", uploaded_at: "2026-10-21T00:00:00Z" });
  assert.equal(getTreeConversionBadge(pdf(), [pdf(), old, latest])?.relatedDocumentId, "latest");
  assert.equal(getTreeConversionBadge(pdf(), [latest, old, pdf()])?.relatedDocumentId, "latest");
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
