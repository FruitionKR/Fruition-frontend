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

const { pickerDocuments } = await import("../src/features/user-settings/lib/documentPicker.ts");

const md = (overrides) => ({ id: "md", filename: "a.md", mime_type: "text/markdown", document_role: "EDITABLE", status: "completed", ...overrides });
const pdf = (overrides) => ({ id: "pdf", filename: "원본.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", status: "completed", ...overrides });

test("Markdown 문서만 목록에 보이고 PDF·TXT 등 다른 파일은 뺀다", () => {
  const txt = { id: "txt", filename: "memo.txt", mime_type: "text/plain", document_role: "EDITABLE", status: "completed" };
  assert.deepEqual(pickerDocuments([md({}), pdf({}), txt], "").map((doc) => doc.id), ["md"]);
});

test("PDF는 변환본이 있어도 목록에 없고 변환된 Markdown만 검색된다", () => {
  const converted = md({ id: "conv", filename: "원본.md", source_document_id: "pdf" });
  assert.deepEqual(pickerDocuments([pdf({}), converted], "원본").map((doc) => doc.id), ["conv"]);
  assert.deepEqual(pickerDocuments([pdf({}), converted], "원본.pdf"), []);
});

const { orderPickerDocuments, skillReferenceFileError, describeSkillReferenceUploadError } = await import("../src/features/user-settings/lib/documentPicker.ts");
const { ApiError } = await import("../src/shared/lib/errors.ts");

test("피커 순서는 고정(선택·방금 올린) 문서 → 참고 문서 → 그 밖의 문서 최근 업로드 순이고 중복은 한 번만 넣는다", () => {
  const old = md({ id: "old", uploaded_at: "2026-01-01T00:00:00Z" });
  const recent = md({ id: "recent", uploaded_at: "2026-03-01T00:00:00Z" });
  const ref2 = md({ id: "ref2", uploaded_at: "2026-02-01T00:00:00Z" });
  const ref1 = md({ id: "ref1", uploaded_at: "2026-01-15T00:00:00Z" });
  const uploaded = md({ id: "uploaded", uploaded_at: "2026-04-01T00:00:00Z" });
  const ordered = orderPickerDocuments([uploaded, old], [uploaded, ref2, ref1], [old, recent]);
  assert.deepEqual(ordered.map((doc) => doc.id), ["uploaded", "old", "ref2", "ref1", "recent"]);
});

test("참고 문서 업로드는 PDF를 막고 Markdown·txt만 받는다", () => {
  assert.match(skillReferenceFileError({ name: "회의록.PDF" }), /PDF는 참고 문서로 올릴 수 없습니다/);
  assert.match(skillReferenceFileError({ name: "image.png" }), /\.md.*\.txt/);
  for (const name of ["양식.md", "양식.markdown", "memo.TXT"]) assert.equal(skillReferenceFileError({ name }), null);
});

test("참고 문서 업로드 실패는 415·이름 충돌·origin 오류를 구분해 안내한다", () => {
  assert.match(describeSkillReferenceUploadError(new ApiError("x", 415, "UNSUPPORTED_FILE_TYPE")), /\.md.*\.txt/);
  assert.match(describeSkillReferenceUploadError(new ApiError("x", 409, "DUPLICATE_NAME")), /같은 이름/);
  assert.match(describeSkillReferenceUploadError(new ApiError("x", 409)), /처리 중/);
  assert.match(describeSkillReferenceUploadError(new ApiError("x", 400, "INVALID_DOCUMENT_ORIGIN")), /올릴 수 없는/);
  assert.match(describeSkillReferenceUploadError(new TypeError("network")), /올리지 못했습니다/);
});
