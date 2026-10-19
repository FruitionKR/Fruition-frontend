import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const {
  visibleSelectableIds, rangeSelection, selectedRootItems, planBulkDelete, bulkResultNotice
} = await import("../src/widgets/workspace/lib/treeBulkSelection.ts");
const { resolveTreeMove } = await import("../src/widgets/workspace/lib/treeMoveRules.ts");

const ROOT = "project-uploaded-documents";
const file = (id, label, extra = {}) => ({ id, label, type: "file", documentId: `doc-${id}`, ...extra });
const tree = () => [{ id: ROOT, folderId: null, title: "문서", items: [
  { id: "f1", label: "폴더1", type: "folder", children: [file("c1", "c1.md"), file("c2", "c2.md")] },
  file("a", "a.md"),
  { id: "w", label: "위키", type: "wiki", children: [file("wc", "wc.md")] },
  file("b", "b.md"),
  { id: "f2", label: "폴더2", type: "folder", children: [] }
] }];

test("보이는 행은 펼친 폴더의 자식까지 위에서 아래 순서이고 위키 행은 빠진다", () => {
  const items = tree()[0].items;
  assert.deepEqual(visibleSelectableIds(items, new Set()), ["f1", "a", "b", "f2"]);
  assert.deepEqual(visibleSelectableIds(items, new Set(["f1", "w"])), ["f1", "c1", "c2", "a", "wc", "b", "f2"]);
});

test("범위 선택은 기준 행과 대상 행 사이를 방향과 관계없이 고른다", () => {
  const visible = ["f1", "c1", "c2", "a", "b"];
  assert.deepEqual(rangeSelection(visible, "c1", "a"), ["c1", "c2", "a"]);
  assert.deepEqual(rangeSelection(visible, "b", "c2"), ["c2", "a", "b"]);
  assert.deepEqual(rangeSelection(visible, "a", "a"), ["a"]);
});

test("기준 행이 없거나 접혀 안 보이면 대상 하나만, 대상이 안 보이면 아무것도 고르지 않는다", () => {
  const visible = ["f1", "a", "b"];
  assert.deepEqual(rangeSelection(visible, null, "a"), ["a"]);
  assert.deepEqual(rangeSelection(visible, "c1", "b"), ["b"]);
  assert.deepEqual(rangeSelection(visible, "a", "hidden"), []);
});

test("선택한 폴더의 하위 항목은 빼고 트리 순서로 돌려준다", () => {
  const result = selectedRootItems(tree(), new Set(["b", "c2", "f1", "a", "gone"]));
  assert.deepEqual(result.map((item) => item.id), ["f1", "a", "b"]);
  assert.deepEqual(selectedRootItems(tree(), new Set(["c2", "c1"])).map((item) => item.id), ["c1", "c2"]);
});

test("묶음 삭제는 위키·업로드 중·삭제 권한 없는 항목을 이유와 함께 건너뛴다", () => {
  const projects = tree();
  projects[0].items.push(
    { id: "up", label: "up.md", type: "file", status: "uploading" },
    file("locked", "locked.md", { canDelete: false })
  );
  const plan = planBulkDelete(projects, new Set(["f1", "c1", "w", "up", "locked", "b"]));
  assert.deepEqual(plan.items.map((item) => item.id), ["f1", "b"]);
  assert.deepEqual(plan.skipped, [
    { label: "위키", reason: "자동 생성 항목은 삭제할 수 없습니다" },
    { label: "up.md", reason: "업로드가 끝나지 않았습니다" },
    { label: "locked.md", reason: "삭제 권한이 없습니다" }
  ]);
});

test("요약 알림은 성공·실패 개수와 실패 이유를 한 번에 담는다", () => {
  assert.deepEqual(bulkResultNotice("삭제", 2, []), { kind: "completed", title: "삭제 완료", message: "2개 항목을 삭제했습니다." });
  const partial = bulkResultNotice("이동", 1, [{ label: "x.md", reason: "권한 없음" }]);
  assert.equal(partial.kind, "failed");
  assert.equal(partial.title, "일부 이동 실패");
  assert.equal(partial.message, "성공 1개, 실패 1개\n「x.md」: 권한 없음");
  const many = bulkResultNotice("삭제", 0, Array.from({ length: 7 }, (_, i) => ({ label: `${i}`, reason: "r" })));
  assert.equal(many.title, "삭제 실패");
  assert.match(many.message, /외 2개$/);
});

test("묶음 이동은 하위 항목을 중복으로 옮기지 않고 트리 순서를 지킨다", () => {
  const selected = new Set(["b", "c1", "f1", "a"]);
  const result = resolveTreeMove(tree(), { projectId: ROOT, itemId: "b" }, { projectId: ROOT, targetId: "f2", position: "inside" }, selected);
  assert.equal(result.kind, "move-many");
  assert.deepEqual(result.items.map((item) => item.id), ["f1", "a", "b"]);
  assert.equal(result.folderId, "f2");
  assert.deepEqual(result.skipped, []);
});

test("묶음 이동은 편집 권한 없음·업로드 중 항목을 건너뛰고 이미 대상 폴더에 있는 항목은 조용히 뺀다", () => {
  const projects = tree();
  projects[0].items.push(file("ro", "ro.md", { canEdit: false }), { id: "up", label: "up.md", type: "file", status: "uploading" });
  const selected = new Set(["c1", "a", "ro", "up"]);
  const result = resolveTreeMove(projects, { projectId: ROOT, itemId: "a" }, { projectId: ROOT, targetId: "f1", position: "inside" }, selected);
  assert.equal(result.kind, "move-many");
  assert.deepEqual(result.items.map((item) => item.id), ["a"]);
  assert.deepEqual(result.skipped.map((entry) => entry.reason), ["편집 권한이 없습니다", "업로드가 끝나지 않았습니다"]);
});

test("같은 이름 두 항목을 한 폴더로 옮기면 뒤의 것만 건너뛴다", () => {
  const projects = [{ id: ROOT, folderId: null, title: "문서", items: [
    { id: "f1", label: "폴더1", type: "folder", children: [file("x1", "x.md")] },
    file("x2", "x.md"),
    { id: "f2", label: "폴더2", type: "folder", children: [] }
  ] }];
  const result = resolveTreeMove(projects, { projectId: ROOT, itemId: "x2" }, { projectId: ROOT, targetId: "f2", position: "inside" }, new Set(["x1", "x2"]));
  assert.deepEqual(result.items.map((item) => item.id), ["x1"]);
  assert.deepEqual(result.skipped, [{ label: "x.md", reason: "대상 폴더에 같은 이름의 항목이 있습니다" }]);
});
