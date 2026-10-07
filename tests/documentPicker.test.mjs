import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { documentDisplayName, filterPickerDocuments } = await import("../src/features/user-settings/lib/documentPicker.ts");

const nfdName = "회의록 양식.pdf".normalize("NFD");

test("NFD로 저장된 한글 파일명도 NFC 검색어로 찾는다", () => {
  const documents = [{ id: "a", filename: nfdName }, { id: "b", filename: "notes.md" }];
  assert.notEqual(nfdName, nfdName.normalize("NFC"));
  assert.deepEqual(filterPickerDocuments(documents, "회의록").map((doc) => doc.id), ["a"]);
  assert.deepEqual(filterPickerDocuments(documents, "회의록".normalize("NFD")).map((doc) => doc.id), ["a"]);
});

test("검색은 대소문자와 앞뒤 공백을 무시하고, 빈 검색어는 전체를 돌려준다", () => {
  const documents = [{ id: "a", filename: "Meeting.MD" }, { id: "b", filename: "plan.md" }];
  assert.deepEqual(filterPickerDocuments(documents, "  meeting ").map((doc) => doc.id), ["a"]);
  assert.equal(filterPickerDocuments(documents, "   "), documents);
});

test("표시 이름은 NFC로 맞춘다", () => {
  assert.equal(documentDisplayName({ filename: nfdName }), "회의록 양식.pdf".normalize("NFC"));
});

const { pickerCandidates, PDF_CONVERTED_NOTICE, PDF_CONVERTING_NOTICE, PDF_NOT_CONVERTED_NOTICE } =
  await import("../src/features/user-settings/lib/documentPicker.ts");

const md = (overrides) => ({ id: "md", filename: "a.md", mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", ...overrides });
const pdf = (overrides) => ({ id: "pdf", filename: "원본.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed", ...overrides });

test("Markdown 문서는 그대로 고르고, PDF·Markdown 외 문서는 목록에서 뺀다", () => {
  const txt = { id: "txt", filename: "memo.txt", mime_type: "text/plain", document_role: "EDITABLE", status: "completed" };
  const candidates = pickerCandidates([md({}), txt], "");
  assert.deepEqual(candidates.map((item) => [item.document.id, item.target?.id, item.notice]), [["md", "md", null]]);
});

test("PDF는 변환이 끝난 Markdown 변환본으로 대신 선택한다", () => {
  const converted = md({ id: "conv", filename: "원본.md", source_document_id: "pdf" });
  const [row] = pickerCandidates([pdf({}), converted], "원본.pdf");
  assert.equal(row.document.id, "pdf");
  assert.equal(row.target?.id, "conv");
  assert.equal(row.notice, PDF_CONVERTED_NOTICE);
});

test("변환본이 없거나 변환 중·실패한 PDF는 고를 수 없고 이유를 안내한다", () => {
  assert.deepEqual(pickerCandidates([pdf({})], "").map((item) => [item.target, item.notice]), [[null, PDF_NOT_CONVERTED_NOTICE]]);
  const converting = md({ id: "conv", source_document_id: "pdf", status: "processing", pipeline_run_id: "convert:1" });
  const [convertingRow] = pickerCandidates([pdf({}), converting], ".pdf");
  assert.equal(convertingRow.target, null);
  assert.equal(convertingRow.notice, PDF_CONVERTING_NOTICE);
  const failed = md({ id: "conv", source_document_id: "pdf", status: "failed" });
  const [failedRow] = pickerCandidates([pdf({}), failed], ".pdf");
  assert.equal(failedRow.target, null);
  assert.equal(failedRow.notice, PDF_NOT_CONVERTED_NOTICE);
});
