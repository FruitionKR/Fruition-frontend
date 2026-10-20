import assert from "node:assert/strict";
import test from "node:test";

const { SUPERSEDED_PLAN_LABEL, supersededFolderPlans } = await import("../src/features/agent-chat/lib/folderPlanSupersede.ts");

const organize = (turnId, status, folder = "folder_x") => ({ turnId, action: "folder_organize", run: { status, target_folder_id: folder } });

test("같은 폴더의 새 계획이 승인 대기에 도달하면 앞선 승인 대기 계획을 대체한다", () => {
  assert.deepEqual(supersededFolderPlans([organize("t1", "awaiting_approval"), organize("t2", "awaiting_approval")]), [{ turnId: "t1", supersededBy: "t2" }]);
  assert.equal(SUPERSEDED_PLAN_LABEL, "새 실행으로 대체됨");
});

test("새 계획이 아직 만들어지는 중이거나 되묻기·실패면 앞선 계획을 그대로 둔다", () => {
  for (const status of ["queued", "planning", "clarification_required", "failed", "rejected", "cancelled"]) {
    assert.deepEqual(supersededFolderPlans([organize("t1", "awaiting_approval"), organize("t2", status)]), [], status);
  }
});

test("새 계획을 이미 승인해 실행 중·완료여도 남은 앞선 승인 대기 계획은 대체한다", () => {
  for (const status of ["executing", "verifying", "completed", "partial_failed"]) {
    assert.deepEqual(supersededFolderPlans([organize("t1", "awaiting_approval"), organize("t2", status)]), [{ turnId: "t1", supersededBy: "t2" }], status);
  }
});

test("승인 처리 중·끝난 앞선 run은 건드리지 않는다", () => {
  for (const status of ["executing", "verifying", "completed", "rejected", "cancelled"]) {
    assert.deepEqual(supersededFolderPlans([organize("t1", status), organize("t2", "awaiting_approval")]), [], status);
  }
});

test("대상 폴더가 다르거나 모르면 각각 남기고, 폴더 정리가 아닌 계획은 보지 않는다", () => {
  assert.deepEqual(supersededFolderPlans([organize("t1", "awaiting_approval", "a"), organize("t2", "awaiting_approval", "b")]), []);
  assert.deepEqual(supersededFolderPlans([organize("t1", "awaiting_approval", null), organize("t2", "awaiting_approval", null)]), []);
  assert.deepEqual(supersededFolderPlans([
    { turnId: "t1", action: "workspace_workflow", run: { status: "awaiting_approval", target_folder_id: "folder_x" } },
    organize("t2", "awaiting_approval")
  ]), []);
  assert.deepEqual(supersededFolderPlans([organize("t1", "awaiting_approval"), { turnId: "t2", action: "folder_organize", run: null }]), []);
});

test("세 번 실행하면 앞선 두 계획 모두 가장 최근 계획으로 대체되고, 다른 폴더 계획은 남는다", () => {
  assert.deepEqual(supersededFolderPlans([
    organize("t1", "awaiting_approval"),
    organize("o1", "awaiting_approval", "other"),
    organize("t2", "awaiting_approval"),
    organize("t3", "awaiting_approval")
  ]), [{ turnId: "t1", supersededBy: "t3" }, { turnId: "t2", supersededBy: "t3" }]);
});

test("뒤 계획이 실패했으면 그 앞의 승인 대기 계획을 기준으로 본다", () => {
  assert.deepEqual(supersededFolderPlans([
    organize("t1", "awaiting_approval"),
    organize("t2", "awaiting_approval"),
    organize("t3", "failed")
  ]), [{ turnId: "t1", supersededBy: "t2" }]);
});

test("거절된 앞선 계획은 거절 대상이 아니지만, 다시 판정할 때(includeRejected)는 대체된 것으로 본다", () => {
  const runs = [organize("t1", "rejected"), organize("t2", "awaiting_approval"), organize("o1", "rejected", "other")];
  assert.deepEqual(supersededFolderPlans(runs), []);
  assert.deepEqual(supersededFolderPlans(runs, { includeRejected: true }), [{ turnId: "t1", supersededBy: "t2" }]);
  // 뒤에 같은 폴더 새 계획이 없는 거절은 그대로 '거절됨'이다.
  assert.deepEqual(supersededFolderPlans([organize("t1", "rejected")], { includeRejected: true }), []);
});
