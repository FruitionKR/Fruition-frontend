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
