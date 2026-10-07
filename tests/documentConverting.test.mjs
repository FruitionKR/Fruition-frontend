import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { isDocumentConverting } = await import("../src/entities/document/lib/documentKind.ts");
const { getConversionNotice, getDocumentConversionView, parseConvertProgress } = await import("../src/entities/document/lib/documentConversion.ts");

test("PDF 변환 placeholder가 처리 중일 때만 변환 중으로 본다", () => {
  assert.equal(isDocumentConverting({ status: "processing", pipeline_run_id: "convert:doc_1" }), true);
  assert.equal(isDocumentConverting({ status: "processing", pipeline_run_id: "run_ingest" }), false);
  assert.equal(isDocumentConverting({ status: "failed", pipeline_run_id: "convert:doc_1" }), false);
  assert.equal(isDocumentConverting({ status: "processing" }), false);
  assert.equal(isDocumentConverting(undefined), false);
});

test("백엔드 변환 단계 문구에서 페이지 진행률을 읽는다", () => {
  assert.equal(parseConvertProgress("PDF 3/10페이지 변환 완료"), "3/10페이지");
  assert.equal(parseConvertProgress("PDF 변환 대기"), null);
  assert.equal(parseConvertProgress(undefined), null);
});

test("변환 중인 Markdown은 MD 문맥 문구와 진행률을 보여 준다", () => {
  const view = getDocumentConversionView({
    status: "processing", pipeline_run_id: "convert:doc_1", processing_state: "running",
    processing_stage: "PDF 2/5페이지 변환 완료", updated_at: "t1"
  });
  assert.deepEqual(view, { progress: "2/5페이지", stalled: false, revision: "PDF 2/5페이지 변환 완료|t1" });
  assert.equal(getConversionNotice(view), "원본 PDF에서 내용을 가져오는 중이에요 (2/5페이지). 변환이 끝나면 편집할 수 있어요.");
  assert.doesNotMatch(getConversionNotice({ ...view, progress: null }), /\(/);
});

test("멈춘 변환은 변환 중 대신 멈춤 안내를 보여 준다", () => {
  const view = getDocumentConversionView({ status: "processing", pipeline_run_id: "convert:doc_1", processing_state: "stalled" });
  assert.equal(view.stalled, true);
  assert.match(getConversionNotice(view), /^변환이 멈췄어요/);
});

test("변환이 끝났거나 일반 편입 중인 문서는 변환 상태가 없다", () => {
  assert.equal(getDocumentConversionView({ status: "completed", pipeline_run_id: "convert:doc_1", processing_stage: "PDF 5/5페이지 변환 완료" }), null);
  assert.equal(getDocumentConversionView({ status: "processing", pipeline_run_id: "run_ingest" }), null);
  assert.equal(getDocumentConversionView(undefined), null);
});
