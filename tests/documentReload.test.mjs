import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { shouldReloadOpenDocument } = await import("../src/widgets/source-preview/lib/documentReload.ts");

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
