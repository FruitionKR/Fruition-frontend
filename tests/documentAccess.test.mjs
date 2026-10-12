import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const {
  PERMISSION_FORBIDDEN_MESSAGE,
  canDeleteDocument,
  describePermissionError,
  isDocumentReadOnly,
  isWriteForbiddenError
} = await import("../src/entities/document/lib/documentAccess.ts");
const { canDragTreeItem } = await import("../src/entities/tree/lib/guards.ts");
const { projectsFromServerTree } = await import("../src/entities/tree/lib/serverTree.ts");
const { ApiError } = await import("../src/shared/lib/errors.ts");

test("can_edit가 false인 문서만 읽기 전용이다", () => {
  assert.equal(isDocumentReadOnly({ can_edit: false }), true);
  assert.equal(isDocumentReadOnly({ can_edit: true }), false);
  // 구 서버 응답(필드 없음)·목록에서 못 찾은 문서는 기본 권한(편집 가능)으로 본다.
  assert.equal(isDocumentReadOnly({}), false);
  assert.equal(isDocumentReadOnly(undefined), false);
});

test("can_delete가 false일 때만 삭제 메뉴를 막는다", () => {
  assert.equal(canDeleteDocument({ can_delete: false }), false);
  assert.equal(canDeleteDocument({ can_delete: true }), true);
  assert.equal(canDeleteDocument(null), true);
});

test("403 DOCUMENT_WRITE_FORBIDDEN은 서버 원문 대신 누가 바꿀 수 있는지 안내한다", () => {
  const forbidden = new ApiError("forbidden", 403, "DOCUMENT_WRITE_FORBIDDEN");
  assert.equal(isWriteForbiddenError(forbidden), true);
  assert.equal(describePermissionError(forbidden), PERMISSION_FORBIDDEN_MESSAGE);
  assert.equal(isWriteForbiddenError(new ApiError("conflict", 409, "DOCUMENT_VERSION_CONFLICT")), false);
  assert.equal(describePermissionError(new Error("네트워크 오류")), "네트워크 오류");
  assert.equal(describePermissionError("?", "기본 문구"), "기본 문구");
});

test("서버 트리의 can_edit·can_delete·permission이 트리 항목으로 옮겨진다", () => {
  const [project] = projectsFromServerTree([
    { type: "document", id: "doc_1", name: "a.md", sort_order: 0, current_version: 1,
      document: { id: "doc_1", filename: "a.md", mime_type: "text/markdown", byte_size: 1, status: "completed", source_uri: "", uploaded_at: "", document_role: "EDITABLE", can_edit: false, can_delete: false, permission: "view" } }
  ]);
  const item = project.items[0];
  assert.equal(item.canEdit, false);
  assert.equal(item.canDelete, false);
  assert.equal(item.permission, "view");
});

test("보기 권한만 있는 문서는 끌어서 옮길 수 없다", () => {
  assert.equal(canDragTreeItem({ id: "f1", label: "a.md", type: "file", canEdit: false }), false);
  assert.equal(canDragTreeItem({ id: "f2", label: "b.md", type: "file", canEdit: true }), true);
  assert.equal(canDragTreeItem({ id: "f3", label: "c.md", type: "file" }), true);
});
