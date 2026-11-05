import assert from "node:assert/strict";
import test from "node:test";
import { documentRestoreMessage } from "../src/entities/operation-log/model/restoreMessage.ts";

const LATER_EDITS_WARNING = "이 작업 뒤에 저장한 수정(직접 편집, 다른 멤버의 편집, 다른 AI 작업)도 함께 사라집니다.";

function change(overrides) {
  return { resource_type: "document", resource_id: "doc_1", before_revision: 2, after_revision: 3, ...overrides };
}

test("작업 뒤에 저장된 버전이 있으면 그 수정도 함께 사라진다고 경고한다", () => {
  const message = documentRestoreMessage("문서 편집", { document_id: "doc_1", from_version: 6, to_version: 2 }, [change()]);
  assert.equal(message, `문서 편집 문서를 6에서 2 버전으로 되돌립니다. ${LATER_EDITS_WARNING}`);
});

test("이 작업이 마지막 저장이면 경고하지 않는다", () => {
  const message = documentRestoreMessage("문서 편집", { document_id: "doc_1", from_version: 3, to_version: 2 }, [change()]);
  assert.equal(message, "문서 편집 문서를 3에서 2 버전으로 되돌립니다.");
});

test("한 작업이 버전을 여러 개 올렸어도 작업 뒤 저장이 없으면 경고하지 않는다", () => {
  const message = documentRestoreMessage("문서 편집", { document_id: "doc_1", from_version: 5, to_version: 2 }, [change({ after_revision: 5 })]);
  assert.equal(message, "문서 편집 문서를 5에서 2 버전으로 되돌립니다.");
});

test("변경 내역으로 작업 후 버전을 모르면 되돌릴 버전 다음 버전을 작업 결과로 본다", () => {
  const unknownAfter = { document_id: "doc_1", from_version: 4, to_version: 2 };
  assert.match(documentRestoreMessage("문서 편집", unknownAfter, [change({ after_revision: null })]), /함께 사라집니다/);
  assert.match(documentRestoreMessage("문서 편집", unknownAfter, []), /함께 사라집니다/);
  assert.match(documentRestoreMessage("문서 편집", unknownAfter, [change({ resource_id: "doc_2", after_revision: 4 })]), /함께 사라집니다/);
  assert.doesNotMatch(documentRestoreMessage("문서 편집", { ...unknownAfter, from_version: 3 }, []), /함께 사라집니다/);
});
