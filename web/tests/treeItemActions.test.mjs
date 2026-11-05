import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { DOCUMENT_PERMISSION_FORBIDDEN_MESSAGE, FOLDER_EDIT_FORBIDDEN_MESSAGE, FOLDER_PERMISSION_OWNER_ONLY_MESSAGE, FOLDER_WITH_ITEMS_DELETE_MESSAGE, FOLDER_WRITE_FORBIDDEN_MESSAGE } = await import("../src/entities/tree/lib/treePermission.ts");
const { planBulkDelete } = await import("../src/widgets/workspace/lib/treeBulkSelection.ts");
const { treeItemMenuAccess, treeContextMenuSections, treeMenuBlockedActions, TREE_MENU_LABELS } = await import("../src/widgets/document-sidebar/model/treeItemActions.ts");

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const note = { id: "n1", label: "회의.md", type: "file", documentId: "d1", mimeType: "text/markdown" };
const text = { id: "t1", label: "메모.txt", type: "file", documentId: "d2", mimeType: "text/plain" };
const pdf = { id: "p1", label: "논문.pdf", type: "file", documentId: "d3", mimeType: "application/pdf", status: "completed" };
const chat = { ...note, id: "c1", label: "채팅 정리.md", titleLocked: true };
const folder = { id: "f1", label: "자료", type: "folder" };
const full = { canCreateProject: true, canImportNotion: true };

/** 메뉴 구성을 "새 노트 · 새 폴더 | 파일 업로드" 꼴 문자열로 바꾼다(｜는 구분선). */
const menu = (item, options = full) => treeContextMenuSections(item, { isRootTarget: item === null, ...options })
  .map((section) => section.map((id) => TREE_MENU_LABELS[id]).join(" · "))
  .join(" | ");

test("최상위·빈 영역·새 노트 추가 메뉴: 새 노트 · 새 폴더 | 파일 업로드 · Notion에서 가져오기", () => {
  assert.equal(menu(null), "새 노트 · 새 폴더 | 파일 업로드 · Notion에서 가져오기");
  // 새 폴더는 뷰 정책을, Notion은 가져오기 연결 여부를 따른다.
  assert.equal(menu(null, { canCreateProject: false, canImportNotion: false }), "새 노트 | 파일 업로드");
});

test("폴더 메뉴: 새 노트 · 새 폴더 | 파일 업로드 | 이름 변경 · 권한 설정 | 삭제 (Notion 가져오기 없음)", () => {
  assert.equal(menu(folder), "새 노트 · 새 폴더 | 파일 업로드 | 이름 변경 · 권한 설정 | 삭제");
});

test("노트·기타 파일 메뉴: 이름 변경 · 권한 설정 · 원본 다운로드 | 삭제 (생성 항목 없음)", () => {
  assert.equal(menu(note), "이름 변경 · 권한 설정 · 원본 다운로드 | 삭제");
  assert.equal(menu(text), "이름 변경 · 권한 설정 · 원본 다운로드 | 삭제");
});

test("PDF 메뉴: Markdown으로 변환 | 권한 설정 · 원본 다운로드 | 삭제", () => {
  assert.equal(menu(pdf), "Markdown으로 변환 | 권한 설정 · 원본 다운로드 | 삭제");
});

test("채팅에서 만든 문서(이름 잠김) 메뉴: 권한 설정 | 삭제", () => {
  assert.equal(menu(chat), "권한 설정 | 삭제");
});

test("트리에서 찾지 못한 항목은 빈 메뉴다(최상위 생성 메뉴로 잘못 열지 않는다)", () => {
  assert.deepEqual(treeContextMenuSections(null, { isRootTarget: false, ...full }), []);
});

test("권한이 없는 항목은 숨기고 빈 구역의 구분선도 함께 빠진다", () => {
  assert.equal(menu({ ...note, canEdit: false, canDelete: false }), "권한 설정 · 원본 다운로드");
  // 변환 권한이 없는 PDF는 변환 항목을 남기고 이유와 함께 비활성화한다(기존 안내 유지, documentConvertAccess 테스트).
  assert.equal(menu({ ...pdf, canConvert: false }), "Markdown으로 변환 | 권한 설정 · 원본 다운로드 | 삭제");
  assert.equal(menu({ ...folder, canEdit: false }), "새 노트 · 새 폴더 | 파일 업로드 | 권한 설정 | 삭제");
});

test("업로드 중 문서는 변환·다운로드·권한 설정을 두지 않는다", () => {
  assert.equal(menu({ ...note, status: "uploading", documentId: undefined }), "이름 변경 | 삭제");
});

test("PDF 원본·보기 전용·자동 생성·이름 잠김 항목은 이름을 바꿀 수 없다", () => {
  for (const item of [pdf, { ...note, canEdit: false }, { ...note, generated: true }, chat]) {
    assert.equal(treeItemMenuAccess(item, { isRootTarget: false }).canRename, false, item.label);
  }
});

test("컨텍스트 메뉴는 구역 사이에 role=separator를 두고 방향키는 menuitem만 오간다", async () => {
  const menuSource = await source("widgets/document-sidebar/ui/ContextMenu.tsx");
  assert.match(menuSource, /role="separator"/);
  assert.match(menuSource, /'\[role="menuitem"\]:not\(:disabled\)'/);
  assert.match(menuSource, /styles\.danger/);
});

test("우클릭·⋯·새 노트 추가 메뉴는 사이드바가 보여 주는 트리에서 항목을 찾아 같은 구성 함수를 쓴다", async () => {
  const sidebar = await source("widgets/document-sidebar/ui/DocumentSidebar.tsx");
  assert.match(sidebar, /treeContextMenuSections\(/);
  assert.match(sidebar, /findTreeItem\(/);
});

test("원본 다운로드는 원본 API로 받고, 메뉴에는 새 탭에서 열기가 없다", async () => {
  const [sidebar, download] = await Promise.all([
    source("widgets/document-sidebar/ui/DocumentSidebar.tsx"),
    source("widgets/document-sidebar/model/downloadTreeItem.ts")
  ]);
  assert.doesNotMatch(sidebar, /open-new-tab/);
  assert.equal(Object.values(TREE_MENU_LABELS).includes("새 탭에서 열기"), false);
  assert.match(download, /fetchDocumentOriginal\(/);
  assert.match(download, /fetchNoteDraft\(/);
  assert.match(download, /link\.download = filename/);
});

test("⋯ 버튼은 파일·폴더 행에만 두고, 항목이 없는 메뉴는 그리지 않고 닫는다", async () => {
  const [treeNode, sidebar] = await Promise.all([
    source("widgets/document-sidebar/ui/TreeNode.tsx"),
    source("widgets/document-sidebar/ui/DocumentSidebar.tsx")
  ]);
  assert.match(treeNode, /const canShowRowActions = \(isFolder \|\| isFileItem\(item\)\)/);
  assert.match(sidebar, /if \(contextMenu && !hasContextMenuItems\) onCloseContextMenu\(\);/);
  assert.match(sidebar, /\{contextMenu && hasContextMenuItems && \(/);
});

test("새 노트 추가 버튼은 바로 만들지 않고 최상위 컨텍스트 메뉴를 연다", async () => {
  const sidebar = await source("widgets/document-sidebar/ui/DocumentSidebar.tsx");
  assert.doesNotMatch(sidebar, /onCreateNote/);
  assert.match(sidebar, /onOpenFolderMenuAt\(rootProject\.id, null, event\.currentTarget, "add-button"\)/);
  assert.match(sidebar, /aria-haspopup="menu"/);
  assert.match(sidebar, /aria-expanded=\{isAddMenuOpen\}/);
  assert.match(sidebar, /focusNewNote=\{contextMenu\.source === "add-button"\}/);
});

test("새 노트 추가 메뉴는 새 노트 항목에 포커스를 두어 Enter 한 번으로 만든다", async () => {
  const menu = await source("widgets/document-sidebar/ui/ContextMenu.tsx");
  assert.match(menu, /data-menu-autofocus=\{\(action === "new-note" && focusNewNote\) \|\| undefined\}/);
  assert.match(menu, /querySelector<HTMLButtonElement>\("\[data-menu-autofocus\]"\)/);
});

test("행 hover에는 ⋯ 버튼 하나만 두고 우클릭과 같은 메뉴를 연다", async () => {
  const treeNode = await source("widgets/document-sidebar/ui/TreeNode.tsx");
  assert.match(treeNode, /aria-label="항목 메뉴 열기"/);
  assert.match(treeNode, /aria-haspopup="menu"/);
  assert.match(treeNode, /aria-expanded=\{interaction\.menuOpenItemId === item\.id\}/);
  assert.match(treeNode, /interaction\.onOpenFolderMenuAt\(projectId, item\.id, event\.currentTarget\)/);
  // 이름 변경·권한 설정·삭제는 hover 버튼으로 따로 두지 않는다.
  assert.doesNotMatch(treeNode, /onTreeItemAction|treeRowActions|SidebarTrashIcon|SidebarRenameIcon|SidebarLockIcon/);
});

test("⋯ 버튼은 hover·키보드 포커스에 보이고 hover가 없는 터치 기기에서는 늘 보인다", async () => {
  const css = await source("widgets/document-sidebar/ui/DocumentSidebar.module.css");
  assert.match(css, /@media \(hover: none\)\s*\{[\s\S]*?\.tree-row-actions\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /\.tree-row-wrap:hover > \.tree-row-trailing > \.tree-row-actions/);
  assert.match(css, /\.tree-row-wrap:has\(:focus-visible\) > \.tree-row-trailing > \.tree-row-actions/);
  assert.doesNotMatch(css, /tree-row-action-slot/);
});

test("메뉴를 닫으면 연 버튼으로 포커스를 돌려준다(연 요소는 첫 렌더에서 잡는다)", async () => {
  const menu = await source("widgets/document-sidebar/ui/ContextMenu.tsx");
  assert.match(menu, /const \[opener\] = useState\(\(\) =>/);
  assert.match(menu, /opener\?\.isConnected\) opener\.focus\(\)/);
});

test("터치 기기에서만 파일·폴더 메뉴에 이동·여러 항목 선택을 더한다", () => {
  assert.equal(menu(note, { ...full, canUseTouchActions: true }), "이름 변경 · 권한 설정 · 원본 다운로드 | 다른 폴더로 이동 · 여러 항목 선택 | 삭제");
  assert.equal(menu(note), "이름 변경 · 권한 설정 · 원본 다운로드 | 삭제");
});

test("쓸 수 없는 폴더의 메뉴는 넣는 항목만 막고, 쓸 수 있거나 모르는 폴더·최상위·파일은 그대로 둔다", () => {
  const denied = (folderId) => folderId === "f1";
  assert.deepEqual([...treeMenuBlockedActions(folder, denied).keys()], ["new-note", "new-folder", "upload", "rename", "delete"]);
  assert.deepEqual([...treeMenuBlockedActions({ ...folder, id: "f2" }, denied).keys()], []);
  assert.deepEqual([...treeMenuBlockedActions(null, denied).keys()], []);
  assert.deepEqual([...treeMenuBlockedActions(note, denied).keys()], []);
});

test("막힌 메뉴 항목은 비활성으로 두고 이유를 메뉴 안에 글자로 보여 준다(터치에는 툴팁이 없다)", async () => {
  const menu = await source("widgets/document-sidebar/ui/ContextMenu.tsx");
  assert.match(menu, /disabled=\{blockedActions\.has\(action\)\}/);
  assert.match(menu, /menu-blocked-reason/);
});

test("꺼낼 수 없는 항목의 터치 메뉴는 이동을 막고 여러 항목 선택은 둔다", () => {
  const denied = () => false;
  assert.deepEqual([...treeMenuBlockedActions(note, denied, () => "이유")], [["move", "이유"]]);
  assert.deepEqual([...treeMenuBlockedActions(note, denied, () => null).keys()], []);
  assert.deepEqual([...treeMenuBlockedActions(note, denied).keys()], [], "판정을 넘기지 않으면 막지 않는다");
});

test("보기 폴더는 이름 변경·삭제를 막고 서버와 같은 이유를 준다", () => {
  const blocked = treeMenuBlockedActions(folder, () => true, () => null, false);
  assert.equal(blocked.get("rename"), FOLDER_EDIT_FORBIDDEN_MESSAGE);
  assert.equal(blocked.get("delete"), FOLDER_EDIT_FORBIDDEN_MESSAGE);
  assert.equal(blocked.get("new-note"), FOLDER_WRITE_FORBIDDEN_MESSAGE);
});

test("내용 있는 폴더 삭제와 폴더 권한 설정은 멤버에게 막고, OWNER와 역할을 모를 때는 열어 둔다", () => {
  const filled = { ...folder, children: [note] };
  const asMember = treeMenuBlockedActions(filled, () => false, () => null, false);
  assert.equal(asMember.get("delete"), FOLDER_WITH_ITEMS_DELETE_MESSAGE);
  assert.equal(asMember.get("permission"), FOLDER_PERMISSION_OWNER_ONLY_MESSAGE);
  assert.equal(asMember.has("rename"), false);
  assert.equal(treeMenuBlockedActions({ ...folder, children: [] }, () => false, () => null, false).has("delete"), false);
  assert.deepEqual([...treeMenuBlockedActions(filled, () => false, () => null, true).keys()], []);
  assert.deepEqual([...treeMenuBlockedActions(filled, () => false, () => null, null).keys()], []);
});

test("남의 문서 권한 설정은 서버가 삭제 불가로 알려 준 문서에서만 막는다", () => {
  assert.equal(treeMenuBlockedActions({ ...note, canDelete: false }, () => false).get("permission"), DOCUMENT_PERMISSION_FORBIDDEN_MESSAGE);
  assert.equal(treeMenuBlockedActions({ ...note, canDelete: true }, () => false).has("permission"), false);
  assert.equal(treeMenuBlockedActions(note, () => false).has("permission"), false);
});

test("묶음 삭제는 폴더 삭제 규칙으로 건너뛴다", () => {
  const projects = [{ id: "p", folderId: null, title: "문서", items: [
    { id: "view", label: "보기", type: "folder", permission: "view", children: [] },
    { id: "full", label: "내용", type: "folder", permission: null, children: [{ id: "x", label: "문서", type: "file", documentId: "x" }] },
    { id: "empty", label: "빈 폴더", type: "folder", permission: null, children: [] }
  ] }];
  const plan = (owner) => planBulkDelete(projects, new Set(["view", "full", "empty"]), owner);
  assert.deepEqual(plan(false).items.map((item) => item.id), ["empty"]);
  assert.deepEqual(plan(false).skipped, [
    { label: "보기", reason: FOLDER_EDIT_FORBIDDEN_MESSAGE },
    { label: "내용", reason: FOLDER_WITH_ITEMS_DELETE_MESSAGE }
  ]);
  assert.equal(plan(true).items.length, 3);
  assert.equal(plan(null).items.length, 3, "역할을 모르면 서버가 판단한다");
});
