import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { effectivePermission, findEffectivePermission, permissionForChildren } = await import("../src/entities/tree/lib/treePermission.ts");
const { inheritedPermissionLabel } = await import("../src/entities/document/lib/documentAccess.ts");
const { projectsFromServerTree } = await import("../src/entities/tree/lib/projectsFromServerTree.ts");

const tree = [
  { id: "f-root", label: "팀", type: "folder", permission: "view", children: [
    { id: "doc-a", label: "a.md", type: "file", permission: null },
    { id: "doc-b", label: "b.md", type: "file", permission: "edit" },
    { id: "f-mid", label: "중간", type: "folder", children: [
      { id: "doc-c", label: "c.md", type: "file" }
    ] },
    { id: "f-edit", label: "공개", type: "folder", permission: "edit", children: [
      { id: "doc-d", label: "d.md", type: "file", permission: null }
    ] }
  ] },
  { id: "f-plain", label: "개인", type: "folder", permission: null, children: [
    { id: "doc-e", label: "e.md", type: "file" }
  ] }
];

test("자기 권한이 있으면 own으로 보고 상위 설정보다 우선한다", () => {
  assert.deepEqual(findEffectivePermission(tree, "doc-b"), { access: "edit", source: "own", fromFolderName: null });
  assert.deepEqual(findEffectivePermission(tree, "f-root"), { access: "view", source: "own", fromFolderName: null });
});

test("상위 설정 따름(null·필드 없음)은 가장 가까운 권한 있는 상위 폴더를 따른다", () => {
  assert.deepEqual(findEffectivePermission(tree, "doc-a"), { access: "view", source: "inherited", fromFolderName: "팀" });
  // 중간 폴더에 권한이 없으면 그 위 폴더까지 올라간다.
  assert.deepEqual(findEffectivePermission(tree, "f-mid"), { access: "view", source: "inherited", fromFolderName: "팀" });
  assert.deepEqual(findEffectivePermission(tree, "doc-c"), { access: "view", source: "inherited", fromFolderName: "팀" });
  // 더 가까운 폴더가 자기 권한을 가지면 그 폴더가 출처다.
  assert.deepEqual(findEffectivePermission(tree, "doc-d"), { access: "edit", source: "inherited", fromFolderName: "공개" });
});

test("자기·상위 모두 권한이 없으면 null, 없는 id는 undefined", () => {
  assert.equal(findEffectivePermission(tree, "doc-e"), null);
  assert.equal(findEffectivePermission(tree, "f-plain"), null);
  assert.equal(findEffectivePermission(tree, "missing"), undefined);
});

test("effectivePermission·permissionForChildren은 상위 값을 그대로 넘기거나 새 출처로 바꾼다", () => {
  const inherited = { access: "view", fromFolderName: "팀" };
  assert.deepEqual(effectivePermission({ permission: undefined }, inherited), { access: "view", source: "inherited", fromFolderName: "팀" });
  assert.equal(effectivePermission({ permission: null }, null), null);
  assert.equal(permissionForChildren({ permission: null, label: "x" }, inherited), inherited);
  assert.deepEqual(permissionForChildren({ permission: "edit", label: "공개" }, inherited), { access: "edit", fromFolderName: "공개" });
});

test("상속 표시 문구는 출처 폴더 이름을 담는다", () => {
  assert.equal(inheritedPermissionLabel("view", "팀"), "보기만 가능 (상위 폴더 '팀'에서 상속)");
  assert.equal(inheritedPermissionLabel("edit", "공개"), "편집 가능 (상위 폴더 '공개'에서 상속)");
});

test("서버 트리의 폴더 permission을 트리 항목으로 옮긴다(없으면 undefined)", () => {
  const [project] = projectsFromServerTree([
    { type: "folder", id: "f1", name: "팀", sort_order: 0, current_version: 1, permission: "view", children: [] },
    { type: "folder", id: "f2", name: "개인", sort_order: 1, current_version: 1, children: [] }
  ]);
  assert.equal(project.items.find((item) => item.id === "f1").permission, "view");
  assert.equal(project.items.find((item) => item.id === "f2").permission, undefined);
});
