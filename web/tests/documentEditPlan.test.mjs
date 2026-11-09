import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { useTranslations } from "./fakeNextIntl.mjs";

// 화면과 같이 agentChat 메시지를 한국어로 풀어 문구까지 확인한다.
const agentChatT = useTranslations("agentChat");

// 앱 소스의 확장자 없는 상대 import(./agentPlan)를 .ts로 푼다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const {
  blockedEditRowIds,
  buildDocumentEditRows: buildDocumentEditRowsWith,
  documentEditRowsNeedTrash,
  documentEditApproval,
  documentEditApprovalHint: documentEditApprovalHintWith,
  documentEditDecisionNote: documentEditDecisionNoteWith,
  documentEditMessageNotice,
  documentEditOperationLabel: documentEditOperationLabelWith,
  documentEditRunnableCount,
  documentEditRunNote: documentEditRunNoteWith,
  editPreviewNotice: editPreviewNoticeWith,
  isDocumentEditPlan,
  missingDiffNote: missingDiffNoteWith
} = await import("../src/features/agent-chat/lib/documentEditPlan.ts");
const buildDocumentEditRows = (plan, rows, previews, tree, trash = []) => buildDocumentEditRowsWith(plan, rows, previews, tree, trash, agentChatT);
const documentEditApprovalHint = (approval, purged = 0, blocked = 0) => documentEditApprovalHintWith(approval, purged, blocked, agentChatT);
const documentEditDecisionNote = (...args) => documentEditDecisionNoteWith(...args, agentChatT);
const documentEditOperationLabel = (...args) => documentEditOperationLabelWith(...args, agentChatT);
const documentEditRunNote = (...args) => documentEditRunNoteWith(...args, agentChatT);
const editPreviewNotice = (...args) => editPreviewNoticeWith(...args, agentChatT);
const missingDiffNote = (...args) => missingDiffNoteWith(...args, agentChatT);
const { editPreviewExpiryDelayMs, isEditPreviewExpired, limitDiffHunks, parseAgentRunEditPreviews } = await import("../src/features/agent-chat/lib/documentEditPreviews.ts");
const { buildFolderOrganizeView: buildFolderOrganizeViewWith, folderOrganizeApproval, initialDeselectedRowIds } = await import("../src/features/agent-chat/lib/folderOrganize.ts");
const buildFolderOrganizeView = (plan, tree, target) => buildFolderOrganizeViewWith(plan, tree, target, agentChatT);

function editOperation(id, documentId, extra = {}) {
  return {
    id, sequence: Number(id.replace(/\D/g, "")), tool_name: "apply_document_edit", target_id: documentId, source_parent_id: null, destination_parent_id: null,
    arguments: { document_id: documentId, base_version: 3, target: { type: "whole_document", start_line: 1, end_line: 9 }, content_artifact_id: `artifact_${id}`, content_hash: "sha256:a" },
    reason: `${documentId} 요약`, status: "planned", error_code: null, depends_on: [], ...extra
  };
}

function editPlan(operations) {
  return { id: "plan_1", version: 1, operation_hash: "h", summary: "아직 바꾸지 않았습니다. 승인하면 문서 3개를 수정합니다.", status: "awaiting_approval", operations };
}

const TREE = [
  { id: "folder_a", name: "회의록", type: "folder", children: [
    { id: "folder_b", name: "2026", type: "folder", children: [{ id: "doc_1", name: "주간 회의.md", type: "document" }] },
    { id: "doc_2", name: "월간 회의.md", type: "document" }
  ] },
  { id: "doc_3", name: "메모.md", type: "document" }
];

function preview(operationId, documentId, extra = {}) {
  return {
    operation_id: operationId, document_id: documentId, display_name: `${documentId}.md`, base_version: 3, summary: `${documentId} 미리 보기 요약`,
    added_lines: 2, removed_lines: 1, hunks: [{ before_start: 4, after_start: 4, lines: [{ type: "delete", text: "옛 줄" }, { type: "insert", text: "새 줄" }] }], ...extra
  };
}

function rowsOf(plan, previews = { items: [], expires_at: null }, tree = TREE) {
  return buildDocumentEditRows(plan, buildFolderOrganizeView(plan, tree).rows, previews, tree);
}

test("모든 작업이 apply_document_edit일 때만 문서 수정 계획이다", () => {
  assert.equal(isDocumentEditPlan(editPlan([editOperation("op1", "doc_1"), editOperation("op2", "doc_2")])), true);
  assert.equal(isDocumentEditPlan(editPlan([editOperation("op1", "doc_1"), { ...editOperation("op2", "doc_2"), tool_name: "move_document" }])), false);
  assert.equal(isDocumentEditPlan(editPlan([])), false, "빈 계획은 기존 화면에 둔다");
  assert.equal(isDocumentEditPlan(null), false);
});

test("미리 보기 응답을 검사해 잘못된 항목·줄은 버리고 모양이 틀리면 실패시킨다", () => {
  const parsed = parseAgentRunEditPreviews({
    expires_at: "2026-11-05T00:00:00Z",
    items: [
      preview("op1", "doc_1", { hunks: [{ before_start: 1, after_start: 1, lines: [{ type: "insert", text: "좋은 줄" }, { type: "weird", text: "x" }, { type: "insert" }] }, "망가진 hunk"] }),
      { document_id: "doc_x" },
      "망가진 항목"
    ]
  });
  assert.equal(parsed.expires_at, "2026-11-05T00:00:00Z");
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0].hunks, [{ before_start: 1, after_start: 1, lines: [{ type: "insert", text: "좋은 줄" }] }]);
  assert.equal(parseAgentRunEditPreviews({ items: [] }).expires_at, null);
  assert.throws(() => parseAgentRunEditPreviews({ items: "아님" }));
  assert.throws(() => parseAgentRunEditPreviews(null));
});

test("숫자가 아닌 줄 수와 시작 줄은 항목을 깨지 않고 0으로 본다", () => {
  const parsed = parseAgentRunEditPreviews({ items: [{ ...preview("op1", "doc_1"), added_lines: "많음", removed_lines: null, hunks: [{ lines: [{ type: "context", text: "" }] }] }] });
  assert.equal(parsed.items[0].added_lines, 0);
  assert.equal(parsed.items[0].removed_lines, 0);
  assert.equal(parsed.items[0].hunks[0].before_start, 0);
});

test("기존 preview route의 create_document는 null 문서 버전과 빈 본문 기준 diff를 보존한다", () => {
  const parsed = parseAgentRunEditPreviews({ items: [{
    ...preview("create-1", null), tool_name: "create_document", document_id: null, base_version: null,
    display_name: "새 문서.md", removed_lines: 0
  }] });
  assert.equal(parsed.items[0].tool_name, "create_document");
  assert.equal(parsed.items[0].document_id, null);
  assert.equal(parsed.items[0].base_version, null);
  assert.equal(parsed.items[0].removed_lines, 0);
  assert.equal(parseAgentRunEditPreviews({ items: [preview("legacy", "doc_1")] }).items[0].tool_name, "apply_document_edit");
});

test("만료 시각이 지나면 만료다. 없거나 읽을 수 없으면 막지 않는다", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(isEditPreviewExpired("2026-11-04T11:59:59Z", now), true);
  assert.equal(isEditPreviewExpired("2026-11-04T12:00:00Z", now), true);
  assert.equal(isEditPreviewExpired("2026-11-04T12:00:01Z", now), false);
  assert.equal(isEditPreviewExpired(null, now), false);
  assert.equal(isEditPreviewExpired("날짜 아님", now), false);
});

test("만료까지 남은 시간은 타이머 한도를 넘지 않고 만료 뒤에는 null이다", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(editPreviewExpiryDelayMs("2026-11-04T12:00:05Z", now), 5_000);
  assert.equal(editPreviewExpiryDelayMs("2026-11-04T11:00:00Z", now), null);
  assert.equal(editPreviewExpiryDelayMs(null, now), null);
  assert.equal(editPreviewExpiryDelayMs("2099-01-01T00:00:00Z", now), 2_147_483_647);
});

test("작업 결과 문구는 계약의 표를 따른다", () => {
  const label = (status, error_code = null) => documentEditOperationLabel({ status, error_code });
  assert.equal(label("planned"), null);
  assert.equal(label("pending"), null);
  assert.equal(label("succeeded"), "완료");
  assert.equal(label("conflicted"), "문서가 바뀌어 저장하지 못했어요. 다시 요청해 주세요.");
  assert.equal(label("failed", "tool_http_423"), "다른 사람이 편집 중이라 저장하지 못했어요.");
  assert.equal(label("failed", "tool_http_404"), "문서를 찾을 수 없어요.");
  assert.equal(label("forbidden"), "권한 없음");
  assert.equal(label("skipped", "not_selected"), "제외됨");
  assert.equal(label("failed", "unknown_code"), "실패");
  assert.equal(label("이상한 상태"), "상태 확인 필요");
});

test("줄마다 트리 경로 제목과 미리 보기 내용을 붙인다", () => {
  const plan = editPlan([editOperation("op1", "doc_1"), editOperation("op2", "doc_2"), editOperation("op3", "doc_3")]);
  const rows = rowsOf(plan, { items: [preview("op1", "doc_1"), preview("op3", "doc_3")], expires_at: null });
  assert.deepEqual(rows.map((row) => row.title), ["회의록 / 2026 / 주간 회의.md", "회의록 / 월간 회의.md", "메모.md"]);
  assert.equal(rows[0].summary, "doc_1 미리 보기 요약");
  assert.equal(rows[0].addedLines, 2);
  assert.equal(rows[0].removedLines, 1);
  assert.equal(rows[0].hunks.length, 1);
  assert.equal(rows[1].hunks, null, "미리 보기가 없는 문서는 hunks가 null이다");
  assert.equal(rows[1].summary, "doc_2 요약", "미리 보기가 없으면 작업 reason을 요약으로 쓴다");
  assert.deepEqual(rows[0].operationIds, ["op1"]);
});

test("트리에 없는 문서는 미리 보기의 현재 제목을 쓰고, 둘 다 없으면 확인 불가로 둔다", () => {
  const plan = editPlan([editOperation("op1", "doc_gone"), editOperation("op2", "doc_gone2")]);
  const rows = rowsOf(plan, { items: [preview("op1", "doc_gone", { display_name: "서버 제목.md" })], expires_at: null });
  assert.equal(rows[0].title, "서버 제목.md");
  assert.equal(rows[1].title, "항목 이름 확인 불가");
});

test("계획에 없는 미리 보기는 무시하고 작업의 경고를 줄에 싣는다", () => {
  const warning = { type: "duplicate_content", message: "내용이 거의 같은 문서가 있어요." };
  const plan = editPlan([editOperation("op1", "doc_1", { warning, suggested_selected: true })]);
  const rows = rowsOf(plan, { items: [preview("op9", "doc_9"), preview("op1", "doc_1")], expires_at: null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].warning, "내용이 거의 같은 문서가 있어요.");
});

test("실행 결과를 줄에 싣고 실패한 줄을 표시한다", () => {
  const plan = editPlan([
    editOperation("op1", "doc_1", { status: "succeeded" }),
    editOperation("op2", "doc_2", { status: "conflicted", error_code: "tool_http_409" }),
    editOperation("op3", "doc_3", { status: "skipped", error_code: "not_selected" })
  ]);
  const rows = rowsOf(plan);
  assert.deepEqual(rows.map((row) => [row.resultLabel, row.isFailure, row.excluded]), [
    ["완료", false, false],
    ["문서가 바뀌어 저장하지 못했어요. 다시 요청해 주세요.", true, false],
    ["제외됨", false, true]
  ]);
});

test("전부 고르면 operation_ids를 생략하고, 해제하면 고른 작업만 보내고, 하나도 안 고르면 막는다", () => {
  const plan = editPlan([editOperation("op1", "doc_1"), editOperation("op2", "doc_2"), editOperation("op3", "doc_3")]);
  const { rows } = buildFolderOrganizeView(plan, TREE);
  assert.equal(folderOrganizeApproval(plan, rows, new Set()).operationIds, null);
  assert.deepEqual(folderOrganizeApproval(plan, rows, new Set(["doc_2"])).operationIds, ["op1", "op3"]);
  const none = folderOrganizeApproval(plan, rows, new Set(["doc_1", "doc_2", "doc_3"]));
  assert.equal(none.canApply, false);
  assert.equal(documentEditApprovalHint(none), "수정할 문서를 하나 이상 골라 주세요.");
});

test("suggested_selected가 false인 문서는 처음부터 해제해 둔다", () => {
  const plan = editPlan([editOperation("op1", "doc_1"), editOperation("op2", "doc_2", { suggested_selected: false })]);
  const { rows } = buildFolderOrganizeView(plan, TREE);
  assert.deepEqual([...initialDeselectedRowIds(rows)], ["doc_2"]);
});

test("카드 안내는 고른 수를 따르고 모두 고르면 힌트가 없다", () => {
  const plan = editPlan([editOperation("op1", "doc_1"), editOperation("op2", "doc_2")]);
  const { rows } = buildFolderOrganizeView(plan, TREE);
  assert.equal(documentEditApprovalHint(folderOrganizeApproval(plan, rows, new Set())), null);
  assert.equal(documentEditApprovalHint(folderOrganizeApproval(plan, rows, new Set(["doc_1"]))), "1개는 제외하고 수정해요.");
  assert.equal(documentEditDecisionNote(2), "아직 바꾸지 않았습니다. 승인하면 문서 2개를 수정합니다.");
  assert.equal(documentEditDecisionNote(0), "아직 바꾸지 않았습니다.");
});

test("계획 요약과 기본 문구를 뺀 결과 메시지만 안내로 남긴다", () => {
  const summary = "아직 바꾸지 않았습니다. 승인하면 문서 2개를 수정합니다.";
  assert.equal(documentEditMessageNotice(summary, summary), null);
  assert.equal(documentEditMessageNotice("작업 계획을 만들었습니다. 미리보기에서 확인해 주세요.", summary), null);
  assert.equal(documentEditMessageNotice(`${summary} '규칙.md'은 편집 권한이 없어 뺐어요.`, summary), "'규칙.md'은 편집 권한이 없어 뺐어요.");
  assert.equal(documentEditMessageNotice("작업 계획을 만들었습니다. 미리보기에서 확인해 주세요.\n\n스킬 없이 처리했어요.", summary), "스킬 없이 처리했어요.");
  assert.equal(documentEditMessageNotice("", summary), null);
});

test("실행이 실패한 run의 안내", () => {
  const run = (status, operations, error_code = null) => ({ status, error_code, plan: editPlan(operations) });
  const saved = editOperation("op1", "doc_1", { status: "succeeded" });
  const conflict = editOperation("op2", "doc_2", { status: "conflicted" });
  const skipped = editOperation("op3", "doc_3", { status: "skipped", error_code: "not_selected" });
  assert.equal(documentEditRunNote(run("completed", [saved])), null);
  assert.equal(documentEditRunNote(run("awaiting_approval", [editOperation("op1", "doc_1")])), null);
  assert.equal(documentEditRunNote(run("partial_failed", [saved, conflict, skipped])), "문서 2개 중 1개를 저장했어요. 저장하지 못한 문서는 문서별 이유를 확인해 주세요.");
  assert.equal(documentEditRunNote(run("conflicted", [conflict])), "문서를 저장하지 못했어요. 문서별 이유를 확인해 주세요.");
  assert.equal(documentEditRunNote(run("conflicted", [saved, conflict])), "문서 2개 중 1개를 저장했어요. 저장하지 못한 문서는 문서별 이유를 확인해 주세요.", "충돌 run이어도 저장된 문서를 말한다");
  assert.equal(documentEditRunNote(run("failed", [editOperation("op1", "doc_1")])), "작업을 완료하지 못했습니다. 문서별 상태를 확인해 주세요.");
  assert.match(documentEditRunNote(run("failed", [editOperation("op1", "doc_1")], "provider_unavailable")), /AI 서비스에 연결하지 못해/);
});

test("미리 보기 상태 안내는 수락의 결과를 정직하게 말한다", () => {
  assert.equal(editPreviewNotice({ state: "ready", missingCount: 0, isExpired: false }), null);
  assert.equal(editPreviewNotice({ state: "loading", missingCount: 0, isExpired: false }), "변경 내용을 불러오는 중이에요.");
  assert.equal(editPreviewNotice({ state: "error", missingCount: 3, isExpired: false }), "변경 내용을 불러오지 못했어요. 수락하면 내용을 확인하지 않은 채 고른 문서가 수정돼요.");
  assert.equal(editPreviewNotice({ state: "ready", missingCount: 1, isExpired: false }), "문서 1개의 변경 내용을 불러오지 못했어요. 수락하면 내용을 확인하지 않은 채 그 문서도 수정돼요.");
  assert.equal(editPreviewNotice({ state: "ready", missingCount: 0, isExpired: true }), "변경안의 보관 기간이 지나 수락할 수 없어요. 다시 요청해 주세요.");
  assert.equal(editPreviewNotice({ state: "error", missingCount: 3, isExpired: true }), "변경안의 보관 기간이 지나 수락할 수 없어요. 다시 요청해 주세요.");
});

test("hunk를 나눠도 줄 수 한도를 지키고 남은 줄 수를 알려 준다", () => {
  const line = { type: "context", text: "x" };
  const hunks = [
    { before_start: 1, after_start: 1, lines: Array(150).fill(line) },
    { before_start: 200, after_start: 200, lines: Array(100).fill(line) },
    { before_start: 400, after_start: 400, lines: Array(30).fill(line) }
  ];
  const limited = limitDiffHunks(hunks, 200);
  assert.deepEqual(limited.hunks.map((hunk) => hunk.lines.length), [150, 50]);
  assert.equal(limited.hiddenLines, 80);
  assert.equal(limited.hunks[1].before_start, 200);
  assert.equal(hunks[1].lines.length, 100, "원본을 바꾸지 않는다");
  const all = limitDiffHunks(hunks, 280);
  assert.deepEqual(all.hunks.map((hunk) => hunk.lines.length), [150, 100, 30]);
  assert.equal(all.hiddenLines, 0);
  assert.deepEqual(limitDiffHunks([], 200), { hunks: [], hiddenLines: 0 });
});

test("끝난 run은 수정안이 만료돼도 불러오기 실패로 보이지 않는다", () => {
  const retention = "보관 기간이 지나 변경 내용은 볼 수 없어요. 로그에서 확인할 수 있어요.";
  assert.equal(missingDiffNote({ isLoading: false, isAwaiting: false, isExpired: true }), retention);
  // 조회 중에는 만료를 아직 모른다.
  assert.equal(missingDiffNote({ isLoading: true, isAwaiting: false, isExpired: false }), "변경 내용을 불러오는 중이에요.");
  // 만료가 아닌 실패는 그대로 알린다.
  assert.equal(missingDiffNote({ isLoading: false, isAwaiting: false, isExpired: false }), "변경 내용을 불러오지 못했어요.");
});

test("승인 대기 run의 만료 안내는 바뀌지 않는다", () => {
  assert.equal(missingDiffNote({ isLoading: false, isAwaiting: true, isExpired: true }), "변경 내용을 불러오지 못했어요.");
  assert.equal(editPreviewNotice({ state: "ready", missingCount: 1, isExpired: true }), "변경안의 보관 기간이 지나 수락할 수 없어요. 다시 요청해 주세요.");
});

const PURGED = { status: "skipped", error_code: "document_purged", reason: "영구 삭제된 문서입니다." };

test("영구 삭제된 문서의 작업은 고를 수 없고 이유를 사람이 읽을 문구로 보여 준다", () => {
  const plan = editPlan([editOperation("op_1", "doc_gone", PURGED), editOperation("op_2", "doc_2")]);
  const { rows } = buildFolderOrganizeView(plan, TREE);
  assert.equal(documentEditOperationLabel(PURGED), "영구 삭제된 문서라 실행하지 않았어요.");
  const [purged, kept] = buildDocumentEditRows(plan, rows, { items: [preview("op_2", "doc_2")], expires_at: null }, TREE);
  assert.deepEqual(
    { title: purged.title, summary: purged.summary, resultLabel: purged.resultLabel, isFailure: purged.isFailure, isPurged: purged.isPurged, excluded: purged.excluded },
    { title: "삭제된 문서", summary: "", resultLabel: "영구 삭제된 문서라 실행하지 않았어요.", isFailure: false, isPurged: true, excluded: true }
  );
  assert.equal(kept.isPurged, false);

  // 저장된 선택에 그 문서가 들어 있어도 승인 요청에는 싣지 않는다.
  const approval = folderOrganizeApproval(plan, rows, new Set());
  assert.deepEqual(approval.operationIds, ["op_2"]);
  assert.equal(approval.selectedCount, 1);
  assert.deepEqual([...initialDeselectedRowIds(rows)], ["doc_gone"]);
});

test("모든 문서가 영구 삭제되면 수락을 막고 이유를 말한다", () => {
  const plan = editPlan([editOperation("op_1", "doc_gone", PURGED)]);
  const { rows } = buildFolderOrganizeView(plan, TREE);
  const approval = folderOrganizeApproval(plan, rows, new Set());
  assert.equal(approval.canApply, false);
  assert.equal(documentEditApprovalHint(approval, rows.length), "수정할 수 있는 문서가 없어요. 대상 문서가 영구 삭제됐어요.");
  assert.equal(documentEditDecisionNote(approval.selectedCount), "아직 바꾸지 않았습니다.");
});

test("영구 삭제로 빠진 문서는 사용자가 뺀 문서로 세지 않는다", () => {
  assert.equal(documentEditApprovalHint({ selectedCount: 2, excludedCount: 1, canApply: true }, 1), null);
  assert.equal(documentEditApprovalHint({ selectedCount: 1, excludedCount: 2, canApply: true }, 1), "1개는 제외하고 수정해요.");
  assert.equal(documentEditApprovalHint({ selectedCount: 0, excludedCount: 2, canApply: false }, 1), "수정할 문서를 하나 이상 골라 주세요.");
});

test("끝난 run에서 영구 삭제로 건너뛴 문서는 실패와 나눠 안내한다", () => {
  const skipped = editOperation("op_1", "doc_gone", PURGED);
  const saved = editOperation("op_2", "doc_2", { status: "succeeded" });
  const failed = editOperation("op_3", "doc_3", { status: "failed" });
  assert.equal(documentEditRunNote({ status: "partial_failed", error_code: null, plan: editPlan([skipped, saved]) }), "문서 1개를 저장했어요. 영구 삭제된 문서 1개는 실행하지 않았어요.");
  assert.equal(documentEditRunNote({ status: "failed", error_code: null, plan: editPlan([skipped]) }), "영구 삭제된 문서라 실행하지 않았어요.");
  assert.equal(documentEditRunNote({ status: "partial_failed", error_code: null, plan: editPlan([skipped, saved, failed]) }), "문서 2개 중 1개를 저장했어요. 저장하지 못한 문서는 문서별 이유를 확인해 주세요.");
});

test("수락 전 안내의 문서 수는 실제로 수정될 문서만 센다", () => {
  assert.equal(documentEditRunnableCount({ selectedCount: 2, isExpired: false }), 2);
  assert.equal(documentEditDecisionNote(documentEditRunnableCount({ selectedCount: 2, isExpired: false })), "아직 바꾸지 않았습니다. 승인하면 문서 2개를 수정합니다.");
  // 변경안이 만료됐으면 승인해도 수정되지 않으므로 수락 안내를 함께 쓰지 않는다.
  assert.equal(documentEditDecisionNote(documentEditRunnableCount({ selectedCount: 1, isExpired: true })), "아직 바꾸지 않았습니다.");
});

test("권한으로 모두 막힌 문서는 수락 대상에서 빼고 보내는 작업과 수를 맞춘다", () => {
  const plan = editPlan([editOperation("op_1", "doc_1"), editOperation("op_2", "doc_2"), editOperation("op_3", "doc_3")]);
  const rows = buildFolderOrganizeView(plan, TREE).rows;
  const blocked = new Set(["op_1"]);
  assert.deepEqual([...blockedEditRowIds(rows, blocked)], ["doc_1"]);
  const approval = documentEditApproval(plan, rows, new Set(), blocked);
  assert.equal(approval.selectedCount, 2);
  assert.deepEqual(approval.operationIds, ["op_2", "op_3"]);
  assert.equal(approval.canApply, true);
  assert.equal(documentEditDecisionNote(documentEditRunnableCount({ selectedCount: approval.selectedCount, isExpired: false })), "아직 바꾸지 않았습니다. 승인하면 문서 2개를 수정합니다.");
  // 막혀서 빠진 문서를 사용자가 뺀 문서로 세지 않는다.
  assert.equal(documentEditApprovalHint(approval, 0, 1), null);
  // 사용자가 뺀 문서만 "제외"로 센다.
  const withUserExcluded = documentEditApproval(plan, rows, new Set(["doc_2"]), blocked);
  assert.deepEqual(withUserExcluded.operationIds, ["op_3"]);
  assert.equal(documentEditApprovalHint(withUserExcluded, 0, 1), "1개는 제외하고 수정해요.");
});

test("막힌 문서가 없으면 지금처럼 계획 전체를 승인한다", () => {
  const plan = editPlan([editOperation("op_1", "doc_1"), editOperation("op_2", "doc_2")]);
  const rows = buildFolderOrganizeView(plan, TREE).rows;
  assert.equal(documentEditApproval(plan, rows, new Set(), new Set()).operationIds, null);
  assert.deepEqual(documentEditApproval(plan, rows, new Set(["doc_1"]), new Set()).operationIds, ["op_2"]);
});

test("모두 막힌 계획은 수락할 수 없고 '고르세요'라고 안내하지 않는다", () => {
  const plan = editPlan([editOperation("op_1", "doc_1"), editOperation("op_2", "doc_2")]);
  const rows = buildFolderOrganizeView(plan, TREE).rows;
  const approval = documentEditApproval(plan, rows, new Set(), new Set(["op_1", "op_2"]));
  assert.equal(approval.selectedCount, 0);
  assert.equal(approval.canApply, false);
  assert.equal(documentEditApprovalHint(approval, 0, 2), null);
  // 고를 수 있는 문서를 사용자가 뺐으면 고르라고 안내한다.
  const free = documentEditApproval(plan, rows, new Set(["doc_2"]), new Set(["op_1"]));
  assert.equal(documentEditApprovalHint(free, 0, 1), "수정할 문서를 하나 이상 골라 주세요.");
});

test("한 문서의 작업 일부만 막히면 그 문서는 고른 채로 두고 막힌 작업만 뺀다", () => {
  const plan = editPlan([editOperation("op_1", "doc_1"), editOperation("op_2", "doc_1"), editOperation("op_3", "doc_2")]);
  const rows = buildFolderOrganizeView(plan, TREE).rows;
  const blocked = new Set(["op_1"]);
  assert.deepEqual([...blockedEditRowIds(rows, blocked)], []);
  const approval = documentEditApproval(plan, rows, new Set(), blocked);
  assert.equal(approval.selectedCount, 2);
  assert.deepEqual(approval.operationIds, ["op_2", "op_3"]);
});

test("영구 삭제로 되돌리지 못한 문서 줄은 보관 기간 대신 영구 삭제를 말한다", () => {
  const operation = { id: "c", sequence: 1, tool_name: "apply_document_edit", target_id: "doc-c", source_parent_id: null, destination_parent_id: null, arguments: { document_id: "doc-c" }, reason: "이유", status: "skipped", error_code: "rollback_document_purged" };
  const plan = { operations: [operation] };
  const [row] = buildDocumentEditRows(plan, buildFolderOrganizeView(plan, []).rows, { items: [], expires_at: null }, []);
  assert.equal(row.isPurged, true);
  assert.equal(row.resultLabel, "영구 삭제된 문서라 되돌리지 못했어요.");
  assert.equal(row.summary, "");
});

test("트리에 없는 문서가 휴지통에 있으면 이름과 이유를 휴지통 기준으로 보여 준다", () => {
  const plan = { operations: [{ id: "op_1", tool_name: "apply_document_edit", target_type: "document", target_id: "doc_gone", status: "failed", error_code: "tool_http_404", arguments: { document_id: "doc_gone" }, depends_on: [] }] };
  const rows = [{ id: "doc_gone", operationIds: ["op_1"], originalName: "항목 이름 확인 불가", reason: "", excluded: false, isPurged: false }];
  const [trashed] = buildDocumentEditRows(plan, rows, null, [], [{ id: "doc_gone", display_name: "지난 회의.md" }]);
  assert.equal(trashed.title, "지난 회의.md");
  assert.match(trashed.resultLabel, /휴지통/);
  assert.equal(trashed.isFailure, true);
  const [unknown] = buildDocumentEditRows(plan, rows, null, []);
  assert.equal(unknown.title, "항목 이름 확인 불가", "휴지통에 없거나 못 읽었으면 지금 문구를 쓴다");
  assert.equal(unknown.resultLabel, "문서를 찾을 수 없어요.");
});

test("트리에 없는 문서 줄이 있을 때만 휴지통을 읽는다", () => {
  const tree = [{ id: "doc_1", name: "a.md" }];
  const row = (id, isPurged = false) => ({ id, isPurged });
  assert.equal(documentEditRowsNeedTrash([row("doc_1")], tree), false);
  assert.equal(documentEditRowsNeedTrash([row("doc_gone")], tree), true);
  assert.equal(documentEditRowsNeedTrash([row("doc_gone", true)], tree), false, "영구 삭제로 확인된 줄은 묻지 않는다");
  assert.equal(documentEditRowsNeedTrash([row("doc_gone")], undefined), false, "트리를 받기 전에는 모른다");
  assert.equal(documentEditRowsNeedTrash([], tree), false);
});
