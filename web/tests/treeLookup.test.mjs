import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { findDocumentFolderId, findParentLabel, findTreeItemInProjects, findFirstSelectableNote } = await import("../src/widgets/workspace/lib/treeLookup.ts");

const items = [
  { id: "f", label: "폴더", type: "folder", children: [
    { id: "a", label: "a.md", type: "file", documentId: "doc-a" }
  ] },
  { id: "b", label: "b.md", type: "file", documentId: "doc-b" }
];

test("findParentLabel은 중첩 항목의 부모 라벨을, 루트 항목은 기본 라벨을 돌려준다", () => {
  assert.equal(findParentLabel(items, "a", "문서"), "폴더");
  assert.equal(findParentLabel(items, "b", "문서"), "문서");
  assert.equal(findParentLabel(items, "missing", "문서"), null);
});

test("findTreeItemInProjects는 여러 프로젝트에서 documentId로 항목을 찾는다", () => {
  const projects = [{ items: [] }, { items }];
  assert.equal(findTreeItemInProjects(projects, "doc-a")?.id, "a");
  assert.equal(findTreeItemInProjects(projects, "doc-x"), null);
});

test("findFirstSelectableNote는 허용 문서가 있는 첫 항목을 고른다", () => {
  assert.equal(findFirstSelectableNote(items, new Set(["doc-b"]))?.id, "b");
  assert.equal(findFirstSelectableNote(items, new Set(["doc-a"]))?.id, "a");
  assert.equal(findFirstSelectableNote([items[1]], new Set()), null);
});

test("문서가 있는 폴더를 트리 위치로 찾는다", () => {
  const projects = [
    { id: "root", folderId: null, title: "", items: [
      { id: "doc-root", label: "루트 문서", documentId: "d-root" },
      { id: "f1", label: "폴더", children: [{ id: "f2", label: "안쪽", children: [{ id: "doc-in", label: "안쪽 문서", documentId: "d-in" }] }] }
    ] },
    { id: "proj", folderId: "project-folder", title: "", items: [{ id: "doc-top", label: "프로젝트 문서", documentId: "d-top" }] }
  ];
  assert.equal(findDocumentFolderId(projects, "d-in"), "f2");
  assert.equal(findDocumentFolderId(projects, "d-root"), null);
  assert.equal(findDocumentFolderId(projects, "d-top"), "project-folder");
  assert.equal(findDocumentFolderId(projects, "없는 문서"), undefined);
});
