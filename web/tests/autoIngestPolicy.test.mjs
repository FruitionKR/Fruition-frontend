import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { shouldAutoIngestUpload, shouldPromptConvertedIngest } = await import("../src/features/wiki-ingest/model/autoIngestPolicy.ts");

const ALLOWED = { serverAutoIngest: false, canIngest: true };

function markdownUpload(overrides = {}) {
  return { document_role: "EDITABLE", mime_type: "text/markdown", ...overrides };
}

function convertedNote(overrides = {}) {
  return {
    id: "note-1",
    filename: "보고서.md",
    mime_type: "text/markdown",
    document_role: "EDITABLE",
    source_document_id: "pdf-1",
    status: "completed",
    pipeline_run_id: "convert:1",
    needs_reingest: false,
    ...overrides
  };
}

const PROMPT_ALLOWED = { ...ALLOWED, isDismissed: false, isQueued: false };

test("설정이 꺼져 있고 편입 권한이 있으면 Markdown·txt 업로드를 바로 편입한다", () => {
  assert.equal(shouldAutoIngestUpload(markdownUpload(), ALLOWED), true);
  assert.equal(shouldAutoIngestUpload(markdownUpload({ mime_type: "text/plain" }), ALLOWED), true);
});

test("설정이 켜져 있으면 서버가 편입하므로 업로드 편입을 다시 요청하지 않는다", () => {
  assert.equal(shouldAutoIngestUpload(markdownUpload(), { ...ALLOWED, serverAutoIngest: true }), false);
});

test("설정을 아직 모르거나 편입 권한이 없거나 확인 중이면 업로드 편입을 요청하지 않는다", () => {
  assert.equal(shouldAutoIngestUpload(markdownUpload(), { ...ALLOWED, serverAutoIngest: null }), false);
  assert.equal(shouldAutoIngestUpload(markdownUpload(), { ...ALLOWED, canIngest: false }), false);
  assert.equal(shouldAutoIngestUpload(markdownUpload(), { ...ALLOWED, canIngest: null }), false);
});

test("PDF 원본 업로드는 바로 편입하지 않는다", () => {
  assert.equal(shouldAutoIngestUpload({ document_role: "ORIGINAL", mime_type: "application/pdf" }, ALLOWED), false);
});

test("편입 전 PDF 변환본을 열면 편입 확인을 묻는다", () => {
  assert.equal(shouldPromptConvertedIngest(convertedNote(), PROMPT_ALLOWED), true);
  // 편입한 적 없는 변환본은 needs_reingest=true여도 첫 편입 대상이다.
  assert.equal(shouldPromptConvertedIngest(convertedNote({ needs_reingest: true }), PROMPT_ALLOWED), true);
});

test("변환 중·변환 실패·편입 중·편입 완료 변환본에는 묻지 않는다", () => {
  assert.equal(shouldPromptConvertedIngest(convertedNote({ status: "processing" }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ status: "completed", processing_state: "running" }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ status: "failed" }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ pipeline_run_id: "ingest:1" }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ pipeline_run_id: "ingest:1", needs_reingest: true }), PROMPT_ALLOWED), false);
});

test("변환본이 아닌 문서·PDF 원본·열린 문서 없음에는 묻지 않는다", () => {
  assert.equal(shouldPromptConvertedIngest(convertedNote({ source_document_id: undefined }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ mime_type: "application/pdf", filename: "보고서.pdf", document_role: "ORIGINAL" }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(undefined, PROMPT_ALLOWED), false);
});

test("세션에 거절했거나 변환 후 편입을 기다리거나 서버 자동 편입·권한 없음이면 묻지 않는다", () => {
  assert.equal(shouldPromptConvertedIngest(convertedNote(), { ...PROMPT_ALLOWED, isDismissed: true }), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote(), { ...PROMPT_ALLOWED, isQueued: true }), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote(), { ...PROMPT_ALLOWED, serverAutoIngest: true }), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote(), { ...PROMPT_ALLOWED, serverAutoIngest: null }), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote(), { ...PROMPT_ALLOWED, canIngest: false }), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote(), { ...PROMPT_ALLOWED, canIngest: null }), false);
});
