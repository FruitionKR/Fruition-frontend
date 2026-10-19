import assert from "node:assert/strict";
import test from "node:test";

const { closeSheetIfSkillGone, openCreateSheet, openDetailSheet } = await import(
  "../src/widgets/skills-view/lib/skillSheet.ts"
);

test("스킬 만들기 시트를 열고, 이미 열려 있으면 입력을 지키려고 그대로 둔다", () => {
  const opened = openCreateSheet(null);
  assert.deepEqual(opened, { kind: "create", key: 1 });
  assert.equal(openCreateSheet(opened), opened);
});

test("작업 탭 '이 요청을 스킬로 저장'은 요청으로 채운 만들기 시트를 열고, 같은 요청이면 그대로 둔다", () => {
  const opened = openCreateSheet(null, "  문서를 주제별 폴더로 정리해줘 ");
  assert.deepEqual(opened, { kind: "create", key: 1, prefillRequest: "문서를 주제별 폴더로 정리해줘" });
  assert.equal(openCreateSheet(opened, "문서를 주제별 폴더로 정리해줘"), opened);
  // 다른 요청이면 새 입력으로 다시 연다(key가 바뀌어 폼이 새로 시작된다).
  assert.deepEqual(openCreateSheet(opened, "회의록을 요약해줘"), { kind: "create", key: 2, prefillRequest: "회의록을 요약해줘" });
  // 빈 요청은 요청 없는 만들기와 같다.
  assert.deepEqual(openCreateSheet(null, "   "), { kind: "create", key: 1 });
});

test("스킬 상세 시트는 같은 스킬이면 그대로, 다른 스킬이면 새로 연다", () => {
  const detail = openDetailSheet(null, "s1");
  assert.deepEqual(detail, { kind: "detail", key: 1, skillId: "s1" });
  assert.equal(openDetailSheet(detail, "s1"), detail);
  assert.deepEqual(openDetailSheet(detail, "s2"), { kind: "detail", key: 2, skillId: "s2" });
  assert.deepEqual(openCreateSheet(detail), { kind: "create", key: 2 });
});

test("목록에서 사라진 스킬의 상세 시트는 닫고, 나머지는 그대로 둔다", () => {
  const detail = openDetailSheet(null, "s1");
  assert.equal(closeSheetIfSkillGone(detail, ["s1", "s2"]), detail);
  assert.equal(closeSheetIfSkillGone(detail, ["s2"]), null);
  const create = openCreateSheet(null);
  assert.equal(closeSheetIfSkillGone(create, []), create);
  assert.equal(closeSheetIfSkillGone(null, []), null);
});
