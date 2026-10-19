import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 앱 소스의 확장자 없는 상대 import(./agentPlan)를 .ts로 푼다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const {
  buildFolderOrganizeView,
  canApplyFolderOrganizeSelection,
  folderOrganizeNotice,
  folderOrganizeSelection,
  initialDeselectedRowIds,
  isFolderOrganizeAction,
  parseSkillCommand,
  selectedCreatedFolders
} = await import("../src/features/agent-chat/lib/folderOrganize.ts");

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
  assert.deepEqual(view.createdFolders, [{ operationId: "op-1", name: "계획" }]);
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
  assert.deepEqual(view.rows, [{
    id: "op-1", originalName: "", folderName: "최상위", newName: "색인.md", changeLabel: "생성", reason: "",
    operationIds: ["op-1"], suggestedSelected: true, duplicateWarning: null, dependencyNote: null, excluded: false
  }]);
  assert.equal(view.targetFolderName, null);
});

test("안내 문구와 적용 가능 여부", () => {
  assert.equal(folderOrganizeNotice(6, 5, ["계획", "회의", "참고"]), "6개 중 5개 선택 • 새 폴더 3개(계획, 회의, 참고)가 만들어져요.");
  assert.equal(folderOrganizeNotice(6, 5, ["계획"], 1), "6개 중 5개 선택 • 1개는 중복 의심이라 선택 해제해 두었어요 • 새 폴더 1개(계획)가 만들어져요.");
  assert.equal(folderOrganizeNotice(2, 2, []), "2개 중 2개 선택");
  assert.equal(canApplyFolderOrganizeSelection(6, null), true);
  assert.equal(canApplyFolderOrganizeSelection(5, ["op-1", "op-2"]), true);
  assert.equal(canApplyFolderOrganizeSelection(0, null), false);
  assert.equal(canApplyFolderOrganizeSelection(3, Array.from({ length: 21 }, (_, index) => `op-${index}`)), false);
});

const warned = (type, message) => ({ warning: { type, message }, suggested_selected: false });
function organizePlan() {
  return { id: "p", version: 1, operation_hash: "h", summary: "", status: "awaiting_approval", operations: [
    op(1, "create_folder", null, { name: "계획", parent_folder_id: "timeline" }),
    op(2, "create_folder", null, { name: "참고", parent_folder_id: "timeline" }),
    op(3, "move_document", "doc-pdf", { folder_id: { $operation_result: "op-1" } }, { depends_on: ["op-1"] }),
    op(4, "rename_document", "doc-pdf", { name: "2026-09_계획_학기별 목표 설정.pdf" }),
    op(5, "move_document", "doc-xlsx", { folder_id: { $operation_result: "op-1" } }, warned("duplicate_name", "같은 위치에 이름이 같은 문서가 있어 중복일 수 있어요.")),
    op(6, "rename_document", "doc-xlsx", { name: "2026-09_계획_학기별 목표 설정.pdf" }, warned("duplicate_name", "같은 위치에 이름이 같은 문서가 있어 중복일 수 있어요.")),
    op(7, "move_document", "doc-md", { folder_id: { $operation_result: "op-2" } }, { suggested_selected: false, warning: { type: "depends_on_unselected", message: "선택 해제한 작업에 기대고 있어요." } })
  ] };
}

test("기본 선택은 suggested_selected를 따르고 중복·의존 안내를 줄에 붙인다", () => {
  const view = buildFolderOrganizeView(organizePlan(), tree);
  const xlsx = view.rows.find((row) => row.id === "doc-xlsx");
  assert.deepEqual(xlsx.operationIds, ["op-5", "op-6"]);
  assert.equal(xlsx.duplicateWarning, "같은 위치에 이름이 같은 문서가 있어 중복일 수 있어요.");
  assert.equal(view.rows.find((row) => row.id === "doc-md").dependencyNote, "선택 해제한 작업에 기대고 있어요.");
  assert.deepEqual([...initialDeselectedRowIds(view.rows)], ["doc-xlsx", "doc-md"]);
  // 한 작업만 suggested_selected false여도 그 줄은 선택 해제한다.
  const mixed = organizePlan();
  mixed.operations[3] = { ...mixed.operations[3], suggested_selected: false };
  assert.deepEqual([...initialDeselectedRowIds(buildFolderOrganizeView(mixed, tree).rows)], ["doc-pdf", "doc-xlsx", "doc-md"]);
});

test("부분 승인은 고른 줄의 모든 작업과 그 작업이 기대는 새 폴더 작업을 보낸다", () => {
  const plan = organizePlan();
  const { rows, createdFolders } = buildFolderOrganizeView(plan, tree);
  const ids = folderOrganizeSelection(plan, rows, new Set(["doc-pdf"]));
  assert.deepEqual(ids, ["op-1", "op-3", "op-4"]);
  assert.deepEqual(selectedCreatedFolders(createdFolders, ids), ["계획"]);
  // $operation_result 참조만 있고 depends_on이 없어도 새 폴더 작업을 함께 넣는다.
  assert.deepEqual(folderOrganizeSelection(plan, rows, new Set(["doc-md"])), ["op-2", "op-7"]);
  assert.deepEqual(folderOrganizeSelection(plan, rows, new Set()), []);
  // 모두 고르면 operation_ids를 생략(null)해 계획 전체를 승인한다.
  assert.equal(folderOrganizeSelection(plan, rows, new Set(rows.map((row) => row.id))), null);
  assert.deepEqual(selectedCreatedFolders(createdFolders, null), ["계획", "참고"]);
});

test("대상 폴더는 target_folder_id를 먼저 쓰고, 없거나 트리에 없으면 가장 많이 옮기는 원래 폴더로 정한다", () => {
  const plan = { ...organizePlan(), operations: organizePlan().operations.map((operation) => ({ ...operation, source_parent_id: operation.target_id ? "timeline" : null })) };
  assert.equal(buildFolderOrganizeView(plan, tree, "root").targetFolderName, "연간 활동 계획서");
  assert.equal(buildFolderOrganizeView(plan, tree, null).targetFolderName, "프로젝트 타임라인");
  assert.equal(buildFolderOrganizeView(plan, tree, "missing-folder").targetFolderName, "프로젝트 타임라인");
});

test("고르지 않아 건너뛴 작업(skipped·not_selected)만 있는 줄은 제외됨으로 본다", () => {
  const plan = organizePlan();
  plan.operations = plan.operations.map((operation) => ["op-5", "op-6"].includes(operation.id)
    ? { ...operation, status: "skipped", error_code: "not_selected" }
    : operation.id === "op-7" ? { ...operation, status: "skipped", error_code: "dependency_failed" } : { ...operation, status: "succeeded" });
  const rows = buildFolderOrganizeView(plan, tree).rows;
  assert.equal(rows.find((row) => row.id === "doc-xlsx").excluded, true);
  assert.equal(rows.find((row) => row.id === "doc-pdf").excluded, false);
  assert.equal(rows.find((row) => row.id === "doc-md").excluded, false);
});
