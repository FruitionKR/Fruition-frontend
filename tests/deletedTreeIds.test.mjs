import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { collectDeletedTreeIds } = await import("../src/widgets/workspace/lib/deletedTreeIds.ts");

const projects = [
  { id: "root", folderId: null, title: "문서", items: [
    { id: "f", label: "폴더", type: "folder", children: [
      { id: "a", label: "a.pdf", type: "file", documentId: "doc-a" },
      { id: "g", label: "하위", type: "folder", children: [
        { id: "c", label: "c.md", type: "file", documentId: "doc-c" }
      ] }
    ] },
    { id: "b", label: "b.md", type: "file", documentId: "doc-b" }
  ] },
  { id: "p2", folderId: "p2", title: "프로젝트", items: [
    { id: "d", label: "d.md", type: "file", documentId: "doc-d" }
  ] }
];

test("문서 하나를 지우면 그 문서만 포함한다", () => {
  assert.deepEqual(collectDeletedTreeIds(projects, "root", "b"), { documentIds: ["doc-b"], treeItemIds: ["b"] });
});

test("폴더를 지우면 중첩된 하위 폴더의 문서까지 모두 포함한다", () => {
  assert.deepEqual(collectDeletedTreeIds(projects, "root", "f"), {
    documentIds: ["doc-a", "doc-c"],
    treeItemIds: ["f", "a", "g", "c"]
  });
});

test("itemId가 null이면 프로젝트 전체를 포함한다", () => {
  assert.deepEqual(collectDeletedTreeIds(projects, "p2", null), { documentIds: ["doc-d"], treeItemIds: ["d"] });
});

test("대상이 트리에 없으면 빈 결과를 돌려준다", () => {
  assert.deepEqual(collectDeletedTreeIds(projects, "root", "missing"), { documentIds: [], treeItemIds: [] });
  assert.deepEqual(collectDeletedTreeIds(projects, "nope", null), { documentIds: [], treeItemIds: [] });
});
