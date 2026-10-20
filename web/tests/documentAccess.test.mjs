import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  // 소스 안의 확장자 없는 상대 import(예: graph.ts → ./documentLabels)도 .ts로 해석한다.
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const {
  PERMISSION_FORBIDDEN_MESSAGE,
  READ_ONLY_DOCUMENT_HINT,
  READ_ONLY_DOCUMENT_MESSAGE,
  READ_ONLY_DOCUMENT_TITLE,
  canDeleteDocument,
  describePermissionError,
  isDocumentBodyLocked,
  isDocumentReadOnly,
  isWriteForbiddenError,
  permissionChangedMessage,
  permissionIndicatorLabel
} = await import("../src/entities/document/lib/documentAccess.ts");
const { canDragTreeItem } = await import("../src/entities/tree/lib/treeGuards.ts");
const { projectsFromServerTree } = await import("../src/entities/tree/lib/projectsFromServerTree.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const { setDocumentPermission, setFolderPermission } = await import("../src/entities/document/api/permission.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

/** 권한 API는 선택된 워크스페이스와 access token을 쓴다. */
function workspaceEnv(t) {
  const original = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null), setItem() {}, removeItem() {} }
  });
  t.after(() => { globalThis.window = original; });
  saveAccessToken("test-access");
}

test("문서·폴더 권한은 PUT .../permission에 {access}로 보내고, 403은 DOCUMENT_WRITE_FORBIDDEN 코드를 보존한다", async (t) => {
  workspaceEnv(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method, JSON.parse(init.body)]);
    if (path.includes("/folders/")) return Response.json({ error: { message: "no", code: "DOCUMENT_WRITE_FORBIDDEN" } }, { status: 403 });
    return Response.json({ access: "view" });
  });

  assert.deepEqual(await setDocumentPermission("doc_1", "view"), { access: "view" });
  const error = await setFolderPermission("folder_1", null).then(() => null, (caught) => caught);

  assert.deepEqual(calls, [
    ["/api/workspaces/ws_test/documents/doc_1/permission", "PUT", { access: "view" }],
    ["/api/workspaces/ws_test/folders/folder_1/permission", "PUT", { access: null }]
  ]);
  assert.equal(describePermissionError(error), PERMISSION_FORBIDDEN_MESSAGE);
});

test("읽기 전용 안내는 상태 문장과 권한 요청 안내 두 줄로 나뉜다", () => {
  assert.equal(READ_ONLY_DOCUMENT_TITLE, "이 문서는 보기 권한만 있어 읽기 전용으로 열었습니다.");
  assert.equal(READ_ONLY_DOCUMENT_HINT, "편집하려면 문서 소유자나 워크스페이스 OWNER에게 편집 권한을 요청해 주세요.");
  assert.equal(READ_ONLY_DOCUMENT_MESSAGE, `${READ_ONLY_DOCUMENT_TITLE}\n${READ_ONLY_DOCUMENT_HINT}`);
});

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

test("트리 권한 표시는 자기 설정이 있을 때만 문구를 낸다", () => {
  assert.equal(permissionIndicatorLabel("view"), "보기만 가능");
  assert.equal(permissionIndicatorLabel("edit"), "편집 가능");
  assert.equal(permissionIndicatorLabel(null), null);
  assert.equal(permissionIndicatorLabel(undefined), null);
});

test("권한 저장 알림은 이름 뒤 조사 없이 바뀐 값을 알려 준다", () => {
  assert.equal(permissionChangedMessage("팀 규칙.md", "view"), "'팀 규칙.md' 권한을 보기만 가능으로 바꿨습니다.");
  assert.equal(permissionChangedMessage("기획", "edit"), "'기획' 권한을 편집 가능으로 바꿨습니다.");
  assert.equal(permissionChangedMessage("기획", null), "'기획' 권한을 상위 설정 따름으로 바꿨습니다.");
});

test("채팅 Wiki page화 문서(ai_origin=chat_export)만 권한과 무관하게 본문을 잠근다", () => {
  assert.equal(isDocumentBodyLocked({ can_edit: true, ai_origin: "chat_export" }), true);
  assert.equal(isDocumentBodyLocked({ can_edit: true, ai_origin: "agent" }), false);
  assert.equal(isDocumentBodyLocked({ can_edit: true, ai_origin: null }), false);
  assert.equal(isDocumentBodyLocked({ can_edit: true }), false, "구 서버 응답은 편집 가능으로 본다");
  assert.equal(isDocumentBodyLocked(undefined), false, "목록에서 아직 못 찾은 문서는 편집 잠금 응답으로 판단한다");
});
