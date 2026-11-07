import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { koMessages, useTranslations } from "./fakeNextIntl.mjs";

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const agentChatT = useTranslations("agentChat");
const koAgentChat = koMessages.agentChat;
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const { checkPlanAccess, checkRowAccess, planAccessMessage: planAccessMessageWith } = await import("../src/features/agent-chat/lib/planAccess.ts");
const planAccessMessage = (...args) => planAccessMessageWith(...args, agentChatT);
const PLAN_OPERATION_BLOCKED_NOTE = koAgentChat.plan.access.operationBlocked;

function folder(id, permission, children = []) {
  return { type: "folder", id, name: id, sort_order: 0, current_version: 1, permission, children };
}

function doc(id, canEdit) {
  return { type: "document", id, name: id, sort_order: 0, current_version: 1, document: canEdit === undefined ? {} : { can_edit: canEdit } };
}

function op(id, tool_name, target_id, args = {}, depends_on) {
  return { id, sequence: 0, tool_name, target_id, source_parent_id: null, destination_parent_id: null, arguments: args, reason: "", status: "planned", depends_on };
}

function plan(operations) {
  return { id: "plan", version: 1, operation_hash: "hash", summary: "", status: "awaiting_approval", operations };
}

const TREE = [
  doc("doc_editable", true),
  doc("doc_view", false),
  doc("doc_old_server"),
  folder("folder_open", null, [folder("folder_open_child", null)]),
  folder("folder_view", "view", [folder("folder_inherit_view", null), folder("folder_reopened", "edit"), doc("doc_in_view", false)]),
  { type: "folder", id: "folder_old_server", name: "x", sort_order: 0, current_version: 1 }
];

const MEMBER = false;
const OWNER = true;
const ROLE_UNKNOWN = null;

function verdictOf(operations, isOwner = MEMBER, selected = null) {
  return checkPlanAccess(plan(operations), TREE, isOwner, selected).verdict;
}

test("문서 작업은 서버가 준 can_edit으로 판단한다", () => {
  assert.equal(verdictOf([op("a", "apply_document_edit", "doc_editable")]), "clear");
  assert.equal(verdictOf([op("a", "apply_document_edit", "doc_view")]), "all_blocked");
  assert.equal(verdictOf([op("a", "rename_document", "doc_view", { display_name: "새 이름" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "apply_document_edit", "doc_view")], OWNER), "all_blocked", "OWNER 판정은 서버 can_edit에 이미 들어 있다");
});

test("target_id가 없으면 인자의 대상을 본다", () => {
  assert.equal(verdictOf([op("a", "apply_document_edit", null, { document_id: "doc_view" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "rename_folder", null, { folder_id: "folder_view" })]), "all_blocked");
});

test("폴더는 자기 설정, 가장 가까운 상위 설정, 기본 편집 순으로 판단한다", () => {
  assert.equal(verdictOf([op("a", "rename_folder", "folder_open")]), "clear");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_open_child")]), "clear");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_view")]), "all_blocked");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_inherit_view")]), "all_blocked");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_reopened")]), "clear");
});

test("옮기거나 만들 위치도 편집할 수 있어야 하고 최상위는 멤버면 쓸 수 있다", () => {
  assert.equal(verdictOf([op("a", "move_document", "doc_editable", { folder_id: "folder_view" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "move_document", "doc_editable", { folder_id: null })]), "clear");
  assert.equal(verdictOf([op("a", "move_document", "doc_view", { folder_id: "folder_open" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "move_folder", "folder_open", { parent_folder_id: "folder_view" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "create_document", null, { folder_id: "folder_view" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "create_folder", null, { parent_folder_id: "folder_view" })]), "all_blocked");
  assert.equal(verdictOf([op("a", "create_folder", null, { parent_folder_id: null })]), "clear");
});

test("보기 전용 폴더에서는 소유 문서도 꺼낼 수 없다(소유자 예외 없음)", () => {
  const tree = [folder("folder_view", "view", [doc("doc_mine", true), folder("folder_child", "edit")]), folder("folder_open", null), doc("doc_root", true)];
  const verdict = (operation, isOwner = MEMBER) => checkPlanAccess(plan([operation]), tree, isOwner, null).verdict;
  assert.equal(verdict(op("a", "move_document", "doc_mine", { folder_id: "folder_open" })), "all_blocked");
  assert.equal(verdict(op("a", "move_document", "doc_mine", { folder_id: null })), "all_blocked", "최상위로도 꺼낼 수 없다");
  assert.equal(verdict(op("a", "move_folder", "folder_child", { parent_folder_id: "folder_open" })), "all_blocked", "폴더 자신이 편집 가능해도 출발 폴더가 막히면 막는다");
  assert.equal(verdict(op("a", "move_document", null, { document_id: "doc_mine", folder_id: "folder_open" })), "all_blocked", "target_id가 없으면 인자의 대상을 본다");
  assert.equal(verdict(op("a", "move_document", "doc_root", { folder_id: "folder_open" })), "clear", "최상위에서 꺼내는 것은 멤버면 된다");
  assert.equal(verdict(op("a", "move_document", "doc_mine", { folder_id: "folder_open" }), OWNER), "clear", "OWNER는 항상 된다");
  assert.equal(verdict(op("a", "rename_document", "doc_mine", { display_name: "x" })), "clear", "이름 변경의 소유자 예외는 그대로다");
  assert.equal(verdict(op("a", "apply_document_edit", "doc_mine")), "clear", "내용 편집의 소유자 예외는 그대로다");
});

test("출발 폴더를 알 수 없으면 막지 않고 서버에 맡긴다", () => {
  const verdict = (operation, isOwner = MEMBER) => checkPlanAccess(plan([operation]), TREE, isOwner, null).verdict;
  assert.equal(verdict(op("a", "move_document", "doc_not_in_tree", { folder_id: "folder_open" })), "clear", "트리에 없는 문서");
  assert.equal(verdict(op("a", "move_folder", "folder_not_in_tree", { parent_folder_id: "folder_open" })), "clear", "트리에 없는 폴더");
  const legacy = [{ type: "folder", id: "folder_old_server", name: "x", sort_order: 0, current_version: 1, children: [doc("doc_in_old", true)] }, folder("folder_open", null)];
  assert.equal(checkPlanAccess(plan([op("a", "move_document", "doc_in_old", { folder_id: "folder_open" })]), legacy, MEMBER, null).verdict, "clear", "permission 키가 없는 구 서버 응답");
  const inView = [folder("folder_view", "view", [doc("doc_mine", true)]), folder("folder_open", null)];
  assert.equal(checkPlanAccess(plan([op("a", "move_document", "doc_mine", { folder_id: "folder_open" })]), inView, ROLE_UNKNOWN, null).verdict, "clear", "역할 확인 전·실패");
});

test("워크스페이스 OWNER는 폴더 설정과 관계없이 편집할 수 있다", () => {
  assert.equal(verdictOf([op("a", "rename_folder", "folder_view")], OWNER), "clear");
  assert.equal(verdictOf([op("a", "move_document", "doc_editable", { folder_id: "folder_inherit_view" })], OWNER), "clear");
});

test("일부 작업만 막히면 some_blocked이고 막힌 작업 수를 센다", () => {
  const access = checkPlanAccess(plan([
    op("a", "rename_document", "doc_editable", { display_name: "x" }),
    op("b", "rename_document", "doc_view", { display_name: "y" })
  ]), TREE, MEMBER, null);
  assert.equal(access.verdict, "some_blocked");
  assert.equal(access.blockedCount, 1);
  assert.deepEqual([...access.blockedOperationIds], ["b"]);
});

test("막힌 작업에 기대는 작업도 실행되지 않으므로 함께 막힌 것으로 센다", () => {
  const operations = [
    op("create", "create_folder", null, { parent_folder_id: "folder_view" }),
    op("move", "move_document", "doc_editable", { folder_id: { $operation_result: "create" } }),
    op("rename", "rename_document", "doc_editable", { display_name: "x" }, ["move"])
  ];
  const access = checkPlanAccess(plan(operations), TREE, MEMBER, null);
  assert.equal(access.verdict, "all_blocked");
  assert.equal(access.blockedCount, 3);
});

test("새로 만드는 폴더가 편집 가능하면 그 안으로 옮기는 작업도 막지 않는다", () => {
  assert.equal(verdictOf([
    op("create", "create_folder", null, { parent_folder_id: null }),
    op("move", "move_document", "doc_editable", { folder_id: { $operation_result: "create" } })
  ]), "clear");
});

test("권한을 모르면 막지 않는다", () => {
  assert.equal(verdictOf([op("a", "apply_document_edit", "doc_old_server")]), "clear", "can_edit 없는 구 서버 응답");
  assert.equal(verdictOf([op("a", "apply_document_edit", "doc_not_in_tree")]), "clear", "트리에 없는 문서");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_not_in_tree")]), "clear", "트리에 없는 폴더");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_old_server")]), "clear", "permission 키가 없는 구 서버 응답");
  assert.equal(verdictOf([op("a", "future_tool", "doc_view")]), "clear", "모르는 도구");
  assert.equal(verdictOf([op("a", "rename_folder", "folder_view")], ROLE_UNKNOWN), "clear", "역할 확인 전·실패");
  assert.equal(verdictOf([op("a", "rename_document", "doc_view", { display_name: "x" })], ROLE_UNKNOWN), "all_blocked", "문서 can_edit은 역할과 무관하게 믿는다");
});

test("부분 선택이면 고른 작업만 기준으로 판단한다", () => {
  const operations = [
    op("a", "rename_document", "doc_editable", { display_name: "x" }),
    op("b", "rename_document", "doc_view", { display_name: "y" })
  ];
  assert.equal(verdictOf(operations, MEMBER, ["a"]), "clear");
  assert.equal(verdictOf(operations, MEMBER, ["b"]), "all_blocked");
  assert.equal(verdictOf(operations, MEMBER, ["a", "b"]), "some_blocked");
  assert.equal(verdictOf(operations, MEMBER, []), "clear");
  assert.deepEqual([...checkPlanAccess(plan(operations), TREE, MEMBER, ["a"]).blockedOperationIds], ["b"], "선택과 관계없이 줄 안내에 쓴다");
});

test("안내 문구는 전부 막힘과 일부 막힘을 구분하고 막힘이 없으면 없다", () => {
  assert.match(planAccessMessage({ verdict: "all_blocked", blockedCount: 2 }), /수락해도 실행할 수 없어요/);
  // 폴더 넣기·꺼내기에는 문서 소유자 예외가 없어 소유자도 이 안내를 본다. 권한을 풀어 줄 수 있는 OWNER를 가리킨다.
  assert.match(planAccessMessage({ verdict: "all_blocked", blockedCount: 2 }), /워크스페이스 OWNER에게/);
  assert.doesNotMatch(planAccessMessage({ verdict: "all_blocked", blockedCount: 2 }), /문서 소유자/);
  const partial = planAccessMessage({ verdict: "some_blocked", blockedCount: 2 });
  assert.match(partial, /작업 2개는/);
  assert.match(partial, /나머지 작업만 실행돼요/);
  assert.equal(planAccessMessage({ verdict: "clear", blockedCount: 0 }), null);
});

test("안내 문구와 항목별 문구는 폴더에 넣기·꺼내기 권한까지 말한다", () => {
  assert.match(planAccessMessage({ verdict: "all_blocked", blockedCount: 1 }), /넣거나 꺼낼/);
  assert.match(planAccessMessage({ verdict: "some_blocked", blockedCount: 1 }), /넣거나 꺼낼/);
  assert.match(PLAN_OPERATION_BLOCKED_NOTE, /넣거나 꺼낼/);
});

test("미리보기는 줄 단위로 센다: 한 줄에 묶인 작업 두 개가 막혀도 1개다", () => {
  const operations = [
    op("m1", "move_document", "doc_editable", { folder_id: "folder_open" }),
    op("r1", "rename_document", "doc_editable", { display_name: "x" }),
    op("m2", "move_document", "doc_view", { folder_id: "folder_open" }),
    op("r2", "rename_document", "doc_view", { display_name: "y" })
  ];
  const rows = [{ id: "doc_editable", operationIds: ["m1", "r1"] }, { id: "doc_view", operationIds: ["m2", "r2"] }];
  const access = checkPlanAccess(plan(operations), TREE, MEMBER, null);
  assert.equal(access.blockedCount, 2, "작업으로는 2개다");
  const row = checkRowAccess(access, rows, new Set());
  assert.deepEqual(row, { verdict: "some_blocked", blockedCount: 1, partlyBlockedCount: 0 });
  const message = planAccessMessage({ ...row, unit: "item" });
  assert.match(message, /항목 1개는/);
  assert.match(message, /나머지 항목만 실행돼요/);
  assert.doesNotMatch(message, /작업 2개/);
});

test("고른 줄이 모두 막히면 all_blocked, 막힌 줄을 빼면 clear다", () => {
  const operations = [
    op("r1", "rename_document", "doc_editable", { display_name: "x" }),
    op("r2", "rename_document", "doc_view", { display_name: "y" })
  ];
  const rows = [{ id: "doc_editable", operationIds: ["r1"] }, { id: "doc_view", operationIds: ["r2"] }];
  const verdict = (selected, deselected) => checkRowAccess(checkPlanAccess(plan(operations), TREE, MEMBER, selected), rows, new Set(deselected)).verdict;
  assert.equal(verdict(["r2"], ["doc_editable"]), "all_blocked");
  assert.equal(verdict(["r1"], ["doc_view"]), "clear");
  assert.equal(verdict([], ["doc_view", "doc_editable"]), "clear", "고른 줄이 없으면 권한 안내를 하지 않는다");
});

test("줄의 작업 중 일부만 막히면 따로 세고, 막히지 않은 새 폴더만 남아도 줄이 모두 막혔으면 all_blocked다", () => {
  const partly = [
    op("m", "move_document", "doc_mine", { folder_id: "folder_view" }),
    op("r", "rename_document", "doc_mine", { display_name: "x" })
  ];
  const tree = [doc("doc_mine", true), folder("folder_view", "view")];
  const row = checkRowAccess(checkPlanAccess(plan(partly), tree, MEMBER, null), [{ id: "doc_mine", operationIds: ["m", "r"] }], new Set());
  assert.deepEqual(row, { verdict: "some_blocked", blockedCount: 0, partlyBlockedCount: 1 });
  assert.match(planAccessMessage({ ...row, unit: "item" }), /항목 1개는 권한이 없는 작업을 빼고 실행돼요/);

  const onlyFolderLeft = [
    op("c", "create_folder", null, { parent_folder_id: null }),
    op("m", "move_document", "doc_view", { folder_id: { $operation_result: "c" } }, ["c"])
  ];
  const access = checkPlanAccess(plan(onlyFolderLeft), TREE, MEMBER, null);
  assert.equal(access.verdict, "some_blocked", "작업으로는 새 폴더가 남는다");
  assert.equal(checkRowAccess(access, [{ id: "doc_view", operationIds: ["m"] }], new Set()).verdict, "all_blocked", "빈 폴더만 만들고 끝나므로 수락을 막는다");
});

test("줄에 안 잡힌 작업만 막혀도 안내한다", () => {
  const operations = [
    op("c", "create_folder", null, { parent_folder_id: "folder_view" }),
    op("r", "rename_document", "doc_editable", { display_name: "x" })
  ];
  const row = checkRowAccess(checkPlanAccess(plan(operations), TREE, MEMBER, null), [{ id: "doc_editable", operationIds: ["r"] }], new Set());
  assert.equal(row.verdict, "some_blocked");
  assert.match(planAccessMessage({ ...row, unit: "item" }), /일부 작업은/);
});
