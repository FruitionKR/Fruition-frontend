import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { autoIngestContextOf, shouldAutoIngestUpload, shouldPromptConvertedIngest } = await import("../src/features/wiki-ingest/model/autoIngestPolicy.ts");

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

test("워크스페이스 응답에서 판정 입력을 만든다(구 서버는 Markdown 설정이 없다)", () => {
  assert.deepEqual(autoIngestContextOf(null, true), { serverAutoIngest: null, canIngest: true });
  assert.deepEqual(autoIngestContextOf({ auto_ingest_on_upload: false }, true), { serverAutoIngest: false, markdownServerAutoIngest: undefined, canIngest: true });
  assert.deepEqual(
    autoIngestContextOf({ auto_ingest_on_upload: true, auto_ingest_markdown_on_upload: false }, false),
    { serverAutoIngest: true, markdownServerAutoIngest: false, canIngest: false }
  );
});

test("새 서버에서 Markdown 설정이 켜져 있으면 서버가 편입하므로 프론트는 업로드 편입을 보내지 않는다", () => {
  assert.equal(shouldAutoIngestUpload(markdownUpload(), { ...ALLOWED, markdownServerAutoIngest: true }), false);
});

test("새 서버에서 Markdown 설정이 꺼져 있으면 사용자가 끈 것이라 프론트도 편입하지 않는다", () => {
  assert.equal(shouldAutoIngestUpload(markdownUpload(), { ...ALLOWED, markdownServerAutoIngest: false }), false);
  assert.equal(shouldAutoIngestUpload(markdownUpload({ mime_type: "text/plain" }), { ...ALLOWED, markdownServerAutoIngest: false }), false);
});

test("auto_ingest_scheduled=true인 변환본은 서버가 곧 편입하므로 묻지 않는다", () => {
  assert.equal(shouldPromptConvertedIngest(convertedNote({ auto_ingest_scheduled: true }), PROMPT_ALLOWED), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ auto_ingest_scheduled: true }), { ...PROMPT_ALLOWED, serverAutoIngest: true }), false);
});

test("auto_ingest_scheduled=false면 PDF 설정이 켜져 있어도 서버가 편입하지 않는 변환본이라 묻는다", () => {
  assert.equal(shouldPromptConvertedIngest(convertedNote({ auto_ingest_scheduled: false }), { ...PROMPT_ALLOWED, serverAutoIngest: true }), true);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ auto_ingest_scheduled: false }), { ...PROMPT_ALLOWED, serverAutoIngest: null }), true);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ auto_ingest_scheduled: false }), PROMPT_ALLOWED), true);
});

test("auto_ingest_scheduled=false여도 권한 없음·거절·편입 대기·편입 시작 후에는 묻지 않는다", () => {
  const unscheduled = convertedNote({ auto_ingest_scheduled: false });
  assert.equal(shouldPromptConvertedIngest(unscheduled, { ...PROMPT_ALLOWED, canIngest: false }), false);
  assert.equal(shouldPromptConvertedIngest(unscheduled, { ...PROMPT_ALLOWED, isDismissed: true }), false);
  assert.equal(shouldPromptConvertedIngest(unscheduled, { ...PROMPT_ALLOWED, isQueued: true }), false);
  assert.equal(shouldPromptConvertedIngest(convertedNote({ auto_ingest_scheduled: false, pipeline_run_id: "ingest:1" }), PROMPT_ALLOWED), false);
});
