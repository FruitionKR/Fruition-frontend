import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const {
  addTreeOpenIds,
  findContextFolderId,
  parseTreeOpenIds,
  serializeTreeOpenIds,
  toggleTreeOpenId,
  treeOpenStorageKey
} = await import("../src/widgets/workspace/lib/treeOpenState.ts");

test("펼침 상태는 워크스페이스별 키에 저장한다", () => {
  assert.equal(treeOpenStorageKey("ws-1"), "fruition.tree-open.ws-1");
  assert.notEqual(treeOpenStorageKey("ws-1"), treeOpenStorageKey("ws-2"));
});

test("저장값을 Set으로 복원하고 손상된 값은 빈 상태로 시작한다", () => {
  assert.deepEqual([...parseTreeOpenIds(serializeTreeOpenIds(new Set(["a", "b"])))], ["a", "b"]);
  assert.deepEqual([...parseTreeOpenIds(null)], []);
  assert.deepEqual([...parseTreeOpenIds("{broken")], []);
  assert.deepEqual([...parseTreeOpenIds("{\"a\":1}")], []);
  assert.deepEqual([...parseTreeOpenIds("[\"a\",1,null]")], ["a"]);
});

test("토글은 원본을 바꾸지 않고 새 Set을 돌려준다", () => {
  const original = new Set(["a"]);
  const closed = toggleTreeOpenId(original, "a");
  const opened = toggleTreeOpenId(original, "b");

  assert.deepEqual([...original], ["a"]);
  assert.deepEqual([...closed], []);
  assert.deepEqual([...opened], ["a", "b"]);
});

test("이미 펼쳐진 폴더만 열면 같은 Set을 돌려준다", () => {
  const original = new Set(["a", "b"]);

  assert.equal(addTreeOpenIds(original, ["a"]), original);
  assert.equal(addTreeOpenIds(original, []), original);
  const next = addTreeOpenIds(original, ["b", "c"]);
  assert.notEqual(next, original);
  assert.deepEqual([...next], ["a", "b", "c"]);
});

test("컨텍스트 메뉴가 폴더를 가리킬 때만 펼칠 폴더 id를 돌려준다", () => {
  const projects = [{
    id: "p1",
    title: "문서",
    items: [{
      id: "folder-1",
      label: "폴더",
      type: "folder",
      children: [{ id: "note-1", label: "노트.md", type: "file" }]
    }]
  }];

  assert.equal(findContextFolderId(projects, { projectId: "p1", itemId: "folder-1", x: 0, y: 0 }), "folder-1");
  assert.equal(findContextFolderId(projects, { projectId: "p1", itemId: "note-1", x: 0, y: 0 }), null);
  assert.equal(findContextFolderId(projects, { projectId: "p1", itemId: null, x: 0, y: 0 }), null);
  assert.equal(findContextFolderId(projects, null), null);
});
