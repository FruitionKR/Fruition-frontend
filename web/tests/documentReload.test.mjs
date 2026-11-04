import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { shouldReloadForSavedPlan, shouldReloadOpenDocument } = await import("../src/widgets/source-preview/lib/documentReload.ts");

const open = (status, converting = false, id = "doc_1") => ({ id, status, converting });

test("PDF 변환이 끝나 바로 인제스트로 넘어가도 본문을 다시 불러온다", () => {
  assert.equal(shouldReloadOpenDocument(open("processing", true), open("processing", false), true), true);
});

test("변환 종료는 저장 상태와 상관없이 다시 불러온다", () => {
  assert.equal(shouldReloadOpenDocument(open("processing", true), open("completed", false), false), true);
});

test("처리 완료는 미저장 편집이 없을 때만 다시 불러온다", () => {
  assert.equal(shouldReloadOpenDocument(open("processing"), open("completed"), true), true);
  assert.equal(shouldReloadOpenDocument(open("processing"), open("completed"), false), false);
});

test("다른 문서로 바뀌었거나 상태 변화가 없으면 다시 불러오지 않는다", () => {
  assert.equal(shouldReloadOpenDocument(open("processing", true, "doc_1"), open("completed", false, "doc_2"), true), false);
  assert.equal(shouldReloadOpenDocument(open("processing", true), open("processing", true), true), false);
});

test("변환 중 묶음이 추가돼 revision이 바뀌면 본문을 다시 불러온다", () => {
  const converting = (revision) => ({ id: "doc_1", status: "processing", converting: true, revision });
  assert.equal(shouldReloadOpenDocument(converting("PDF 1/3페이지 변환 완료|t1"), converting("PDF 2/3페이지 변환 완료|t2"), false), true);
  assert.equal(shouldReloadOpenDocument(converting("PDF 1/3페이지 변환 완료|t1"), converting("PDF 1/3페이지 변환 완료|t1"), true), false);
  assert.equal(shouldReloadOpenDocument({ ...converting("a"), id: "doc_2" }, converting("b"), true), false);
});

test("계획이 저장한 문서가 열린 문서이고 저장 안 된 입력이 없을 때만 본문을 다시 읽는다", () => {
  const clean = { openDocumentId: "doc_a", savedDocumentIds: ["doc_a", "doc_b"], isSaved: true, hasUnsyncedInput: false, hasActiveReview: false };
  assert.equal(shouldReloadForSavedPlan(clean), true);
  assert.equal(shouldReloadForSavedPlan({ ...clean, savedDocumentIds: ["doc_b"] }), false, "다른 문서만 저장");
  assert.equal(shouldReloadForSavedPlan({ ...clean, openDocumentId: null }), false);
  assert.equal(shouldReloadForSavedPlan({ ...clean, isSaved: false }), false, "저장 안 된 입력은 기존 병합에 맡긴다");
  assert.equal(shouldReloadForSavedPlan({ ...clean, hasUnsyncedInput: true }), false, "아직 저장 대기열에 오르지 않은 입력도 지우지 않는다");
  assert.equal(shouldReloadForSavedPlan({ ...clean, hasActiveReview: true }), false, "검토 중인 제안은 편집기를 다시 만들면 사라진다");
});
