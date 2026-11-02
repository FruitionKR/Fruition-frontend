import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const {
  AGENT_AUTO_APPROVAL_CATEGORIES,
  DEFAULT_AGENT_AUTO_APPROVAL,
  toggleAgentAutoApproval
} = await import("../src/features/user-settings/lib/agentAutoApproval.ts");
const { fetchAgentAutoApproval, saveAgentAutoApproval } = await import("../src/features/user-settings/api/agentAutoApproval.ts");
const { autoApprovedPlanNote, canApproveAgentPlan, isAutoApprovedPlan } = await import("../src/features/agent-chat/lib/agentPlan.ts");
const { resolveTaskStatus, withAutoApprovalLabel } = await import("../src/features/agent-chat/lib/taskThread.ts");

test("자동 승인은 기본으로 모두 꺼져 있다", () => {
  assert.deepEqual(DEFAULT_AGENT_AUTO_APPROVAL, { content_edit: false, organize: false });
  assert.deepEqual(AGENT_AUTO_APPROVAL_CATEGORIES.map((category) => category.key), ["organize", "content_edit"]);
});

test("이동·이름 변경은 바로 켜고 끈다", () => {
  const on = toggleAgentAutoApproval(DEFAULT_AGENT_AUTO_APPROVAL, "organize");
  assert.deepEqual(on, { next: { content_edit: false, organize: true }, needsConfirmation: false });
  assert.deepEqual(toggleAgentAutoApproval(on.next, "organize").next, DEFAULT_AGENT_AUTO_APPROVAL);
  // 원래 설정은 바꾸지 않는다.
  assert.equal(DEFAULT_AGENT_AUTO_APPROVAL.organize, false);
});

test("문서 편집·생성은 켤 때만 한 번 더 확인받는다", () => {
  const unconfirmed = toggleAgentAutoApproval(DEFAULT_AGENT_AUTO_APPROVAL, "content_edit");
  assert.equal(unconfirmed.needsConfirmation, true);
  assert.deepEqual(unconfirmed.next, DEFAULT_AGENT_AUTO_APPROVAL);

  const confirmed = toggleAgentAutoApproval(DEFAULT_AGENT_AUTO_APPROVAL, "content_edit", true);
  assert.deepEqual(confirmed, { next: { content_edit: true, organize: false }, needsConfirmation: false });
  // 끄는 것은 확인 없이 바로 한다.
  assert.deepEqual(toggleAgentAutoApproval(confirmed.next, "content_edit"), { next: DEFAULT_AGENT_AUTO_APPROVAL, needsConfirmation: false });
  assert.match(AGENT_AUTO_APPROVAL_CATEGORIES.find((category) => category.key === "content_edit").confirmOnEnable.description, /버전 기록/);
});

test("설정 조회·저장은 사용자 설정 API를 쓴다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    return Response.json(init?.method === "PUT" ? JSON.parse(init.body) : DEFAULT_AGENT_AUTO_APPROVAL);
  });

  assert.deepEqual(await fetchAgentAutoApproval("ws_test"), DEFAULT_AGENT_AUTO_APPROVAL);
  assert.deepEqual(await saveAgentAutoApproval("ws_test", { content_edit: true, organize: false }), { content_edit: true, organize: false });
  assert.deepEqual(calls, [
    { path: "/api/workspaces/ws_test/agent/auto-approval-settings", method: "GET", body: null },
    { path: "/api/workspaces/ws_test/agent/auto-approval-settings", method: "PUT", body: { content_edit: true, organize: false } }
  ]);
});

test("저장 실패는 서버 오류로 알린다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "INVALID_REQUEST", message: "잘못된 요청" } }, { status: 400 }));
  await assert.rejects(() => saveAgentAutoApproval("ws_test", { content_edit: true, organize: true }));
});

const autoRun = (status, operations) => ({
  id: "run-1",
  status,
  error_code: null,
  plan: { id: "plan-1", version: 1, operation_hash: "a".repeat(64), status: status === "awaiting_approval" ? "awaiting_approval" : "approved", approved_by: "auto:user-setting", operations }
});
const op = (tool_name) => ({ id: tool_name, sequence: 1, tool_name, target_id: "doc-1", source_parent_id: null, destination_parent_id: null, arguments: {}, reason: "", status: "succeeded" });

test("자동 승인한 계획만 자동 승인됨으로 본다", () => {
  assert.equal(isAutoApprovedPlan(autoRun("executing", [op("move_document")])), true);
  const manual = autoRun("completed", [op("move_document")]);
  manual.plan.approved_by = "user";
  assert.equal(isAutoApprovedPlan(manual), false);
  assert.equal(isAutoApprovedPlan({ plan: { ...manual.plan, approved_by: undefined } }), false);
  assert.equal(isAutoApprovedPlan(null), false);
});

test("자동 승인한 계획에는 승인 버튼 대신 되돌리는 방법을 안내한다", () => {
  const run = autoRun("executing", [op("apply_document_edit"), op("create_document"), op("move_document")]);
  assert.equal(canApproveAgentPlan(run), false);
  const note = autoApprovedPlanNote(run.plan);
  assert.match(note, /자동 승인/);
  assert.match(note, /버전 기록/);
  assert.match(note, /휴지통/);
  assert.match(note, /다시 정리/);
  assert.doesNotMatch(autoApprovedPlanNote({ operations: [op("rename_folder")] }), /버전 기록|휴지통/);
});

test("작업 목록 상태에 자동 승인됨을 붙인다", () => {
  const done = resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "completed", operationCount: 2 });
  assert.equal(withAutoApprovalLabel(done, true).label, "저장됨(2) · 자동 승인됨");
  assert.equal(withAutoApprovalLabel(done, false), done);
  const running = resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "executing" });
  assert.equal(withAutoApprovalLabel(running, true).label, "실행 중 · 자동 승인됨");
  // 승인 대기(수동 승인으로 남은 계획)에는 붙이지 않는다.
  const awaiting = resolveTaskStatus({ action: "folder_organize", messageStatus: "completed", runStatus: "awaiting_approval" });
  assert.equal(withAutoApprovalLabel(awaiting, true).label, "승인 대기");
});
