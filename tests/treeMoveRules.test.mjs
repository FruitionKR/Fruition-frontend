import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { resolveTreeMove } = await import("../src/widgets/workspace/lib/treeMoveRules.ts");

const ROOT = "project-uploaded-documents";
const file = (id, label) => ({ id, label, type: "file", documentId: `doc-${id}` });
const projects = () => [{ id: ROOT, folderId: null, title: "문서", items: [
  { id: "folder", label: "폴더", type: "folder", children: [file("inner", "inner.md")] },
  file("a", "a.md"),
  file("b", "b.md"),
  file("dup", "inner.md")
] }];
const none = new Set();

test("단일 항목을 폴더 안으로 옮기면 move 결과에 폴더 id가 담긴다", () => {
  const result = resolveTreeMove(projects(), { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "folder", position: "inside" }, none);
  assert.equal(result.kind, "move");
  assert.equal(result.item.id, "a");
  assert.equal(result.folderId, "folder");
  assert.equal(result.position, undefined);
});

test("형제 사이로 옮기면 대상 위치 기준으로 position을 계산한다", () => {
  const after = resolveTreeMove(projects(), { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "b", position: "after" }, none);
  assert.equal(after.kind, "move");
  // 이동 항목(a)을 제외한 형제 [folder, b, dup]에서 b 뒤 → 2
  assert.equal(after.position, 2);
  assert.equal(after.folderId, null);
});

test("같은 이름이 있는 폴더로 옮기면 conflict를 돌려준다", () => {
  const result = resolveTreeMove(projects(), { projectId: ROOT, itemId: "dup" }, { projectId: ROOT, targetId: "folder", position: "inside" }, none);
  assert.deepEqual(result, { kind: "conflict" });
});

test("문서 위에 문서를 놓으면 merge 결과를 돌려준다", () => {
  const result = resolveTreeMove(projects(), { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "b", position: "inside" }, none);
  assert.equal(result.kind, "merge");
  assert.equal(result.sourceItem.id, "a");
  assert.equal(result.targetItem.id, "b");
  assert.deepEqual(result.destination, { projectId: ROOT, folderId: null });
});

test("묶음 이동은 문서 위 드롭도 merge 대신 부모 폴더로 옮긴다", () => {
  const selected = new Set(["a", "b"]);
  const result = resolveTreeMove(projects(), { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "inner", position: "inside" }, selected);
  assert.equal(result.kind, "move-many");
  assert.deepEqual(result.items.map((item) => item.id), ["a", "b"]);
  assert.equal(result.folderId, "folder");
});

test("묶음 이동에서 이름이 겹치면 conflict를 돌려준다", () => {
  const selected = new Set(["a", "dup"]);
  const result = resolveTreeMove(projects(), { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "folder", position: "inside" }, selected);
  assert.deepEqual(result, { kind: "conflict" });
});

test("위키 항목이나 documentId 없는 파일은 invalid다", () => {
  const p = projects();
  p[0].items.push({ id: "w", label: "위키", type: "wiki" }, { id: "pending", label: "p.md", type: "file" });
  assert.deepEqual(resolveTreeMove(p, { projectId: ROOT, itemId: "w" }, { projectId: ROOT, targetId: "folder", position: "inside" }, none), { kind: "invalid" });
  assert.deepEqual(resolveTreeMove(p, { projectId: ROOT, itemId: "pending" }, { projectId: ROOT, targetId: "folder", position: "inside" }, none), { kind: "invalid" });
  assert.deepEqual(resolveTreeMove(p, null, { projectId: ROOT, targetId: "folder", position: "inside" }, none), { kind: "invalid" });
});
