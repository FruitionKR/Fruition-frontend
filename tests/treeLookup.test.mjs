import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { findParentLabel, findTreeItemInProjects, findFirstSelectableNote } = await import("../src/widgets/workspace/lib/treeLookup.ts");

const items = [
  { id: "f", label: "폴더", type: "folder", children: [
    { id: "a", label: "a.md", type: "file", documentId: "doc-a" },
    { id: "n", label: "노트", type: "wiki", graphNodeId: "node-n" }
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

test("findFirstSelectableNote는 허용 문서 또는 그래프 노드가 있는 첫 항목을 고른다", () => {
  assert.equal(findFirstSelectableNote(items, new Set(["doc-b"]))?.id, "n");
  assert.equal(findFirstSelectableNote(items, new Set(["doc-a"]))?.id, "a");
  assert.equal(findFirstSelectableNote([items[1]], new Set()), null);
});
