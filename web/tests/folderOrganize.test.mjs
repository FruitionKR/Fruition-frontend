import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFolderOrganizeView,
  canApplyFolderOrganizeSelection,
  folderOrganizeNotice,
  isFolderOrganizeAction,
  parseSkillCommand
} from "../src/features/agent-chat/lib/folderOrganize.ts";

const tree = [
  { id: "root", name: "연간 활동 계획서", type: "folder", children: [
    { id: "timeline", name: "프로젝트 타임라인", type: "folder", children: [
      { id: "doc-pdf", name: "학기별 목표 설정.pdf", type: "document" },
      { id: "doc-xlsx", name: "1학기 일정표.xlsx", type: "document" },
      { id: "doc-md", name: "메모.md", type: "document" }
    ] }
  ] }
];

function op(sequence, tool_name, target_id, args = {}, extra = {}) {
  return { id: `op-${sequence}`, sequence, tool_name, target_id, source_parent_id: null, destination_parent_id: null, arguments: args, reason: "", status: "pending", ...extra };
}

test("폴더 정리 action만 폴더 정리 화면으로 분류하고 문서 편집은 기존 화면에 둔다", () => {
  assert.equal(isFolderOrganizeAction("folder_organize"), true);
  for (const action of ["markdown_edit", "markdown_create", "workspace_workflow", "chat_answer", undefined]) {
    assert.equal(isFolderOrganizeAction(action), false);
  }
});

test("스킬 커맨드와 정리 규칙을 나눈다", () => {
  assert.deepEqual(parseSkillCommand("/file-organize  날짜_분류_제목 형식으로 "), { command: "/file-organize", rule: "날짜_분류_제목 형식으로" });
  assert.deepEqual(parseSkillCommand("/file-organize"), { command: "/file-organize", rule: "" });
  assert.deepEqual(parseSkillCommand("폴더 정리해줘"), { command: null, rule: "폴더 정리해줘" });
  assert.deepEqual(parseSkillCommand(null), { command: null, rule: "" });
});

test("작업을 항목별 한 줄로 묶고 새 폴더 참조를 이름으로 푼다", () => {
  const plan = { id: "p", version: 1, operation_hash: "h", summary: "", status: "awaiting_approval", operations: [
    op(1, "create_folder", null, { name: "계획", parent_folder_id: "timeline" }),
    op(2, "move_document", "doc-pdf", { folder_id: { $operation_result: "op-1" } }, { source_parent_id: "timeline" }),
    op(3, "rename_document", "doc-pdf", { name: "2026-09_계획_학기별 목표 설정.pdf" }),
    op(4, "move_document", "doc-xlsx", { folder_id: { $operation_result: "op-1" } }, { source_parent_id: "timeline", reason: "일정 자료라 계획으로 옮겨요." }),
    op(5, "rename_document", "doc-md", { name: "2026-09_참고_메모.md" })
  ] };
  const view = buildFolderOrganizeView(plan, tree);
  assert.deepEqual(view.createdFolders, ["계획"]);
  assert.equal(view.targetFolderName, "프로젝트 타임라인");
  assert.deepEqual(view.rows.map(({ id, originalName, folderName, newName, changeLabel, reason }) => [id, originalName, folderName, newName, changeLabel, reason]), [
    ["doc-pdf", "학기별 목표 설정.pdf", "계획", "2026-09_계획_학기별 목표 설정.pdf", "이동 · 이름", ""],
    ["doc-xlsx", "1학기 일정표.xlsx", "계획", "1학기 일정표.xlsx", "이동", "일정 자료라 계획으로 옮겨요."],
    ["doc-md", "메모.md", "프로젝트 타임라인", "2026-09_참고_메모.md", "이름", ""]
  ]);
});

test("새 문서 생성은 원래 이름 없이 생성으로 표시한다", () => {
  const plan = { id: "p", version: 1, operation_hash: "h", summary: "", status: "awaiting_approval", operations: [
    op(1, "create_document", null, { name: "색인.md", folder_id: null })
  ] };
  const view = buildFolderOrganizeView(plan, tree);
  assert.deepEqual(view.rows, [{ id: "op-1", originalName: "", folderName: "최상위", newName: "색인.md", changeLabel: "생성", reason: "" }]);
  assert.equal(view.targetFolderName, null);
});

test("안내 문구와 적용 가능 여부", () => {
  assert.equal(folderOrganizeNotice(6, 5, ["계획", "회의", "참고"]), "6개 중 5개 선택 • 새 폴더 3개(계획, 회의, 참고)가 만들어져요.");
  assert.equal(folderOrganizeNotice(2, 2, []), "2개 중 2개 선택");
  assert.equal(canApplyFolderOrganizeSelection(6, 6), true);
  assert.equal(canApplyFolderOrganizeSelection(6, 5), false);
});
