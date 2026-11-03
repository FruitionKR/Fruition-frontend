import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { treeItemMenuAccess } = await import("../src/widgets/document-sidebar/model/treeItemActions.ts");

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const note = { id: "n1", label: "회의.md", type: "file", documentId: "d1", mimeType: "text/markdown" };
const folder = { id: "f1", label: "자료", type: "folder" };

test("최상위(루트) 메뉴는 생성 항목만 연다", () => {
  assert.deepEqual(treeItemMenuAccess(null, { isRootTarget: true }), {
    canCreateIn: true,
    canRename: false,
    canDelete: true,
    canSetPermission: false
  });
});

test("폴더는 생성·이름 변경·권한 설정·삭제를 모두 허용한다", () => {
  assert.deepEqual(treeItemMenuAccess(folder, { isRootTarget: false }), {
    canCreateIn: true,
    canRename: true,
    canDelete: true,
    canSetPermission: true
  });
});

test("파일 메뉴는 생성 항목을 숨긴다", () => {
  assert.equal(treeItemMenuAccess(note, { isRootTarget: false }).canCreateIn, false);
});

test("PDF 원본·보기 전용·자동 생성 항목은 이름을 바꿀 수 없다", () => {
  for (const item of [
    { ...note, mimeType: "application/pdf" },
    { ...note, canEdit: false },
    { ...note, generated: true }
  ]) {
    assert.equal(treeItemMenuAccess(item, { isRootTarget: false }).canRename, false, item.label);
  }
});

test("서버 can_delete=false면 삭제할 수 없다", () => {
  assert.equal(treeItemMenuAccess({ ...note, canDelete: false }, { isRootTarget: false }).canDelete, false);
});

test("업로드 중·위키 항목은 권한 설정을 열지 않는다", () => {
  assert.equal(treeItemMenuAccess({ ...note, status: "uploading" }, { isRootTarget: false }).canSetPermission, false);
  assert.equal(treeItemMenuAccess({ id: "w", label: "개념", type: "wiki" }, { isRootTarget: false }).canSetPermission, false);
});

test("우클릭·⋯·새 노트 추가 메뉴는 같은 권한 판정을 쓴다", async () => {
  const projectTree = await source("widgets/workspace/model/useProjectTree.ts");
  assert.match(projectTree, /treeItemMenuAccess\(contextMenuItem/);
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
  assert.match(menu, /data-menu-autofocus=\{focusNewNote \|\| undefined\}[^>]*>새 노트<\/button>/);
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
