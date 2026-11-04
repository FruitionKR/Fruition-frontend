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

const { isDropDeniedByFolder } = await import("../src/widgets/workspace/lib/treeMoveRules.ts");
const guarded = () => [{ id: ROOT, folderId: null, title: "문서", items: [
  { id: "locked", label: "보기 전용", type: "folder", permission: "view", children: [
    file("mine", "mine.md"),
    file("other", "other.md"),
    { id: "inner-open", label: "다시 연 폴더", type: "folder", permission: "edit", children: [] },
    { id: "inner-inherit", label: "따르는 폴더", type: "folder", permission: null, children: [] }
  ] },
  { id: "open", label: "열린 폴더", type: "folder", permission: null, children: [] },
  { id: "legacy", label: "구 서버 폴더", type: "folder", children: [file("in-legacy", "in-legacy.md")] },
  file("root-doc", "root-doc.md"),
  file("root-doc2", "root-doc2.md")
] }];
const MEMBER = false;
const OWNER = true;
const inside = (targetId) => ({ projectId: ROOT, targetId, position: "inside" });
const dragged = (itemId) => ({ projectId: ROOT, itemId });

test("쓸 수 없는 폴더로는 옮길 수 없다", () => {
  assert.deepEqual(resolveTreeMove(guarded(), dragged("root-doc"), inside("locked"), none, MEMBER), { kind: "forbidden" });
  assert.deepEqual(resolveTreeMove(guarded(), dragged("root-doc"), inside("inner-inherit"), none, MEMBER), { kind: "forbidden" }, "상위 설정을 따른다");
  assert.equal(resolveTreeMove(guarded(), dragged("root-doc"), inside("inner-open"), none, MEMBER).kind, "move", "자기 설정이 우선이다");
  assert.deepEqual(resolveTreeMove(guarded(), dragged("root-doc"), inside("mine"), none, MEMBER), { kind: "forbidden" }, "그 폴더 안 문서 위에 놓아 묶는 것도 막는다");
});

test("쓸 수 없는 폴더에서는 소유 문서도 꺼낼 수 없다", () => {
  assert.deepEqual(resolveTreeMove(guarded(), dragged("mine"), inside("open"), none, MEMBER), { kind: "forbidden" });
  assert.deepEqual(resolveTreeMove(guarded(), dragged("mine"), { projectId: ROOT, targetId: null, position: "inside" }, none, MEMBER), { kind: "forbidden" }, "최상위로 꺼내기");
  assert.deepEqual(resolveTreeMove(guarded(), dragged("inner-open"), inside("open"), none, MEMBER), { kind: "forbidden" }, "폴더 이동");
});

test("OWNER·역할을 모를 때·권한 필드가 없는 구 서버는 막지 않는다", () => {
  assert.equal(resolveTreeMove(guarded(), dragged("root-doc"), inside("locked"), none, OWNER).kind, "move");
  assert.equal(resolveTreeMove(guarded(), dragged("mine"), inside("open"), none, OWNER).kind, "move");
  assert.equal(resolveTreeMove(guarded(), dragged("root-doc"), inside("locked"), none, null).kind, "move");
  assert.equal(resolveTreeMove(guarded(), dragged("root-doc"), inside("locked"), none).kind, "move", "역할을 넘기지 않으면 모르는 것으로 본다");
  assert.equal(resolveTreeMove(guarded(), dragged("root-doc"), inside("legacy"), none, MEMBER).kind, "move");
  assert.equal(resolveTreeMove(guarded(), dragged("in-legacy"), inside("open"), none, MEMBER).kind, "move");
});

test("묶음 이동은 목적지가 막히면 전부 막고, 출발 폴더가 막힌 항목은 이유와 함께 건너뛴다", () => {
  const selected = new Set(["root-doc", "mine"]);
  assert.deepEqual(resolveTreeMove(guarded(), dragged("root-doc"), inside("locked"), new Set(["root-doc", "root-doc2"]), MEMBER), { kind: "forbidden" });
  const result = resolveTreeMove(guarded(), dragged("root-doc"), inside("open"), selected, MEMBER);
  assert.equal(result.kind, "move-many");
  assert.deepEqual(result.items.map((item) => item.id), ["root-doc"]);
  assert.deepEqual(result.skipped, [{ label: "mine.md", reason: "이 폴더에 넣거나 꺼낼 권한이 없습니다." }]);
});

test("드래그 중인 줄이 가리키는 위치가 막혔는지 안다", () => {
  assert.equal(isDropDeniedByFolder(guarded(), inside("locked"), MEMBER), true);
  assert.equal(isDropDeniedByFolder(guarded(), inside("mine"), MEMBER), true, "문서 위는 그 문서의 폴더를 본다");
  assert.equal(isDropDeniedByFolder(guarded(), inside("open"), MEMBER), false);
  assert.equal(isDropDeniedByFolder(guarded(), inside("root-doc"), MEMBER), false, "최상위 문서 위");
  assert.equal(isDropDeniedByFolder(guarded(), { projectId: ROOT, targetId: null, position: "inside" }, MEMBER), false, "최상위");
  assert.equal(isDropDeniedByFolder(guarded(), inside("locked"), OWNER), false);
  assert.equal(isDropDeniedByFolder(guarded(), inside("locked"), null), false);
});

test("쓸 수 없는 폴더는 이동 대상에 비활성으로 남고, 최상위와 쓸 수 있는 폴더는 고를 수 있다", () => {
  const denied = (folderId) => folderId === "locked" || folderId === "inner-inherit";
  const blocked = (list) => list.map((entry) => `${entry.label}:${entry.isBlocked}`);
  assert.deepEqual(
    blocked(listMoveDestinations(guarded()[0].items, new Set(["root-doc"]), null, "문서", denied)),
    ["보기 전용:true", "다시 연 폴더:false", "따르는 폴더:true", "열린 폴더:false", "구 서버 폴더:false"]
  );
  assert.deepEqual(
    blocked(listMoveDestinations(guarded()[0].items, new Set(["in-legacy"]), "legacy", "문서", denied)).slice(0, 2),
    ["문서:false", "보기 전용:true"]
  );
  assert.equal(listMoveDestinations(tree, new Set(["n2"]), undefined, "문서").every((entry) => entry.isBlocked === false), true, "판정을 넘기지 않으면 막지 않는다");
});

test("보기 폴더 자체를 옮기려 하면 멤버는 시작 전에 막고, 폴더 편집 권한이 이유다", async () => {
  const { moveDeniedReason, isMoveOutDenied, resolveTreeMove: resolve } = await import("../src/widgets/workspace/lib/treeMoveRules.ts");
  const { FOLDER_EDIT_FORBIDDEN_MESSAGE, FOLDER_WRITE_FORBIDDEN_MESSAGE } = await import("../src/entities/tree/lib/treePermission.ts");
  const projects = [{ id: "p", folderId: null, title: "문서", items: [
    { id: "view", label: "보기", type: "folder", permission: "view", children: [{ id: "sub", label: "하위", type: "folder", permission: null, children: [] }, { id: "doc", label: "문서", type: "file", documentId: "d" }] },
    { id: "open", label: "열림", type: "folder", permission: null, children: [] }
  ] }];
  assert.equal(moveDeniedReason(projects, "view", false), FOLDER_EDIT_FORBIDDEN_MESSAGE);
  // 보기 폴더 안 항목은 꺼낼 권한이 이유다. 하위 폴더는 보기를 물려받아 편집도 막힌다.
  assert.equal(moveDeniedReason(projects, "doc", false), FOLDER_WRITE_FORBIDDEN_MESSAGE);
  assert.equal(moveDeniedReason(projects, "sub", false), FOLDER_WRITE_FORBIDDEN_MESSAGE);
  assert.equal(moveDeniedReason(projects, "open", false), null);
  assert.equal(moveDeniedReason(projects, "view", true), null);
  assert.equal(moveDeniedReason(projects, "view", null), null);
  assert.equal(isMoveOutDenied(projects, "view", false), true);
  const dragged = { projectId: "p", itemId: "view" };
  assert.equal(resolve(projects, dragged, { projectId: "p", targetId: "open", position: "inside" }, new Set(), false).kind, "forbidden");
  assert.equal(resolve(projects, dragged, { projectId: "p", targetId: null, position: "inside" }, new Set(), true).kind, "move");
});
