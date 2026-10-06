import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { isDocumentConverting } = await import("../src/entities/document/lib/documentKind.ts");

test("PDF 변환 placeholder가 처리 중일 때만 변환 중으로 본다", () => {
  assert.equal(isDocumentConverting({ status: "processing", pipeline_run_id: "convert:doc_1" }), true);
  assert.equal(isDocumentConverting({ status: "processing", pipeline_run_id: "run_ingest" }), false);
  assert.equal(isDocumentConverting({ status: "failed", pipeline_run_id: "convert:doc_1" }), false);
  assert.equal(isDocumentConverting({ status: "processing" }), false);
  assert.equal(isDocumentConverting(undefined), false);
});
