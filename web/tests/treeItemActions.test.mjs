import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { treeItemMenuAccess, treeRowActions, TREE_ITEM_ACTION_LABELS } = await import("../src/widgets/document-sidebar/model/treeItemActions.ts");

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

test("행 hover 버튼은 권한이 있는 동작만 이름 변경·권한 설정·삭제 순으로 보인다", () => {
  assert.deepEqual(treeRowActions(note).map((action) => action.id), ["rename", "permission", "delete"]);
  assert.deepEqual(treeRowActions(folder).map((action) => action.id), ["rename", "permission", "delete"]);
  assert.deepEqual(treeRowActions({ ...note, canEdit: false, canDelete: false }).map((action) => action.id), ["permission"]);
  assert.deepEqual(treeRowActions({ ...note, mimeType: "application/pdf" }).map((action) => action.id), ["permission", "delete"]);
});

test("행 hover 버튼 문구는 컨텍스트 메뉴와 같은 한국어 라벨을 쓴다", () => {
  assert.deepEqual(treeRowActions(note).map((action) => action.label), ["이름 변경", "권한 설정", "삭제"]);
  assert.equal(TREE_ITEM_ACTION_LABELS.more, "더 보기");
});

test("업로드 중·위키 행에는 hover 버튼을 두지 않는다", () => {
  assert.deepEqual(treeRowActions({ ...note, status: "uploading" }), []);
  assert.deepEqual(treeRowActions({ id: "w", label: "개념", type: "wiki" }), []);
});

test("컨텍스트 메뉴와 행 hover 버튼이 같은 권한 판정을 쓴다", async () => {
  const [projectTree, treeNode] = await Promise.all([
    source("widgets/workspace/model/useProjectTree.ts"),
    source("widgets/document-sidebar/ui/TreeNode.tsx")
  ]);
  assert.match(projectTree, /treeItemMenuAccess\(contextMenuItem/);
  assert.match(treeNode, /treeRowActions\(item\)/);
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

test("행 hover 버튼은 aria-label과 ⋯ 메뉴 버튼(aria-haspopup)을 가진다", async () => {
  const treeNode = await source("widgets/document-sidebar/ui/TreeNode.tsx");
  assert.match(treeNode, /aria-label=\{`\$\{item\.label\} \$\{action\.label\}`\}/);
  assert.match(treeNode, /aria-label=\{`\$\{item\.label\} \$\{TREE_ITEM_ACTION_LABELS\.more\}`\}/);
  assert.match(treeNode, /aria-haspopup="menu"/);
  assert.match(treeNode, /interaction\.onTreeItemAction\(projectId, item\.id, action\.id\)/);
});

test("hover가 없는 터치 기기에서는 ⋯ 버튼을 늘 보인다", async () => {
  const css = await source("widgets/document-sidebar/ui/DocumentSidebar.module.css");
  assert.match(css, /@media \(hover: none\)\s*\{[\s\S]*?\.tree-row-actions\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /\.tree-row-wrap:has\(:focus-visible\) > \.tree-row-trailing > \.tree-row-actions/);
});
