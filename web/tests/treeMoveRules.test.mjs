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

test("묶음 이동에서 이름이 겹치는 항목은 이유와 함께 건너뛰고 나머지는 옮긴다", () => {
  const selected = new Set(["a", "dup"]);
  const result = resolveTreeMove(projects(), { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "folder", position: "inside" }, selected);
  assert.equal(result.kind, "move-many");
  assert.deepEqual(result.items.map((item) => item.id), ["a"]);
  assert.deepEqual(result.skipped, [{ label: "inner.md", reason: "대상 폴더에 같은 이름의 항목이 있습니다" }]);
});

test("documentId 없는 파일은 invalid다", () => {
  const p = projects();
  p[0].items.push({ id: "pending", label: "p.md", type: "file" });
  assert.deepEqual(resolveTreeMove(p, { projectId: ROOT, itemId: "pending" }, { projectId: ROOT, targetId: "folder", position: "inside" }, none), { kind: "invalid" });
  assert.deepEqual(resolveTreeMove(p, null, { projectId: ROOT, targetId: "folder", position: "inside" }, none), { kind: "invalid" });
});

test("폴더를 자기 자신이나 하위 폴더 안으로 옮기면 cycle을 돌려준다", () => {
  const nested = [{ id: ROOT, folderId: null, title: "문서", items: [
    { id: "outer", label: "바깥", type: "folder", children: [
      { id: "inner", label: "안쪽", type: "folder", children: [] }
    ] },
    file("a", "a.md")
  ] }];
  const drag = { projectId: ROOT, itemId: "outer" };
  assert.equal(resolveTreeMove(nested, drag, { projectId: ROOT, targetId: "inner", position: "inside" }, none).kind, "cycle");
  assert.equal(resolveTreeMove(nested, drag, { projectId: ROOT, targetId: "outer", position: "inside" }, none).kind, "invalid");
  // 묶음 이동에서는 순환이 되는 폴더만 이유와 함께 건너뛰고 나머지는 옮긴다
  const many = resolveTreeMove(nested, drag, { projectId: ROOT, targetId: "inner", position: "inside" }, new Set(["outer", "a"]));
  assert.equal(many.kind, "move-many");
  assert.deepEqual(many.items.map((item) => item.id), ["a"]);
  assert.deepEqual(many.skipped, [{ label: "바깥", reason: "자기 자신이나 하위 폴더 안으로 옮길 수 없습니다" }]);
  // 다른 폴더로는 정상 이동
  assert.equal(resolveTreeMove(nested, { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "inner", position: "inside" }, none).kind, "move");
});

const { listMoveDestinations } = await import("../src/widgets/workspace/lib/treeMoveRules.ts");
const tree = [
  { id: "f1", label: "연구", type: "folder", children: [{ id: "f2", label: "논문", type: "folder", children: [] }, file("n1", "n1.md")] },
  { id: "gen", label: "자동", type: "folder", generated: true, children: [] },
  file("n2", "n2.md")
];
const summary = (list) => list.map((entry) => `${entry.depth}:${entry.label}`);

test("이동 대상은 최상위와 폴더를 트리 순서로 나열하고 자동 생성 폴더는 뺀다", () => {
  assert.deepEqual(summary(listMoveDestinations(tree, new Set(["n2"]), undefined, "문서")), ["0:문서", "1:연구", "2:논문"]);
});

test("옮길 폴더 자신과 그 하위는 대상에서 뺀다", () => {
  assert.deepEqual(summary(listMoveDestinations(tree, new Set(["f1"]), null, "문서")), []);
});

test("지금 있는 폴더는 고를 수 없고 그 하위는 고를 수 있다", () => {
  assert.deepEqual(summary(listMoveDestinations(tree, new Set(["n1"]), "f1", "문서")), ["0:문서", "2:논문"]);
});
