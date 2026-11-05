import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const { isPurgedIngestRestore, restoreFailureMessage, restoreTargetDocumentId, shouldCheckRestoreDocument } = await import("../src/entities/operation-log/model/restoreFailure.ts");
const change = (overrides) => ({ resource_type: "document", resource_id: "doc_1", ...overrides });
const PURGED = "영구 삭제된 문서의 변경은 되돌릴 수 없어요.";
const notFound = new ApiError("문서를 찾을 수 없습니다.", 404, "DOCUMENT_NOT_FOUND");
const invalid = (message) => new ApiError(message, 400, "INVALID_RESTORE_REQUEST");

test("문서가 없어 거절되면 문서가 어디 있는지에 맞춰 안내한다", () => {
  assert.equal(restoreFailureMessage(notFound, "purged"), PURGED);
  assert.match(restoreFailureMessage(notFound, "trash"), /휴지통/);
  assert.equal(restoreFailureMessage(notFound, "unknown"), "문서를 찾을 수 없어 되돌릴 수 없어요.", "휴지통을 못 읽었으면 영구 삭제로 단정하지 않는다");
});

test("대상 문서가 없어진 작업의 400도 영구 삭제로 안내하고, 문서가 살아 있으면 서버 문구를 쓴다", () => {
  const error = invalid("되돌릴 대상에 원문 페이지가 없습니다. 이미 되돌려졌는지 확인해 주세요.");
  assert.equal(restoreFailureMessage(error, "purged"), PURGED);
  assert.equal(restoreFailureMessage(error, "live"), "되돌릴 대상에 원문 페이지가 없습니다. 이미 되돌려졌는지 확인해 주세요.");
});

test("문서 위치를 확인할 실패만 고르고 다른 실패는 조회 없이 그대로 안내한다", () => {
  assert.equal(shouldCheckRestoreDocument(notFound, "doc_1"), true);
  assert.equal(shouldCheckRestoreDocument(invalid("되돌릴 Wiki 페이지가 없습니다."), "doc_1"), true);
  assert.equal(shouldCheckRestoreDocument(invalid("되돌릴 Wiki 페이지가 없습니다."), null), false, "문서를 모르는 작업");
  assert.equal(shouldCheckRestoreDocument(new ApiError("로그 없음", 404, "AI_OPERATION_NOT_FOUND"), "doc_1"), false);
  assert.equal(shouldCheckRestoreDocument(new ApiError("서버 오류", 500), "doc_1"), false);
  assert.equal(restoreFailureMessage(new Error("연결 끊김"), null), "연결 끊김");
});

test("서버 문구의 내부 식별자는 안내에 보이지 않는다", () => {
  assert.equal(restoreFailureMessage(invalid("되돌릴 문서 변경내역이 없습니다: operationId=op_123"), "live"), "되돌릴 문서 변경내역이 없습니다");
  assert.equal(restoreFailureMessage(invalid("문서가 이미 해당 편집 revision 내용입니다: revision=3"), null), "문서가 이미 해당 편집 revision 내용입니다");
});

test("되돌릴 문서는 작업 대상을 먼저 보고 없으면 변경 내역에서 찾는다", () => {
  assert.equal(restoreTargetDocumentId({ target_document_id: "doc_t", changes: [change()] }), "doc_t");
  assert.equal(restoreTargetDocumentId({ target_document_id: null, changes: [change({ resource_type: "wiki_page", resource_id: "p" }), change({ resource_id: "doc_c" })] }), "doc_c");
  assert.equal(restoreTargetDocumentId({ target_document_id: null, changes: [] }), null);
});

test("문서 ID가 사라진 인제스트 행은 영구 삭제로 안내한다", () => {
  const noPages = new ApiError("되돌릴 Wiki 페이지가 없습니다.", 400, "INVALID_RESTORE_REQUEST");
  const row = { operation_type: "ingest", target_document_id: null, target_display_name: "회의록.md", changes: [] };
  assert.equal(isPurgedIngestRestore(noPages, row), true);
  assert.equal(isPurgedIngestRestore(noPages, { ...row, target_display_name: null }), false, "어떤 문서였는지 모르면 단정하지 않는다");
  assert.equal(isPurgedIngestRestore(noPages, { ...row, target_document_id: "doc_1" }), false, "문서 ID가 있으면 위치를 확인한다");
  assert.equal(isPurgedIngestRestore(noPages, { ...row, operation_type: "lint" }), false, "lint는 원래 문서가 없다");
  assert.equal(isPurgedIngestRestore(new ApiError("서버 오류", 500), row), false);
  assert.equal(isPurgedIngestRestore(noPages, null), false);
});
