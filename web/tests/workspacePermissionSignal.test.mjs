import assert from "node:assert/strict";
import test from "node:test";

const {
  PERMISSION_SIGNAL_COALESCE_MS,
  notifyWorkspacePermissionDenied,
  permissionDeniedWorkspaceId,
  subscribeWorkspacePermissionDenied
} = await import("../src/shared/lib/workspacePermissionSignal.ts");

test("권한 부족 403(WORKSPACE_PERMISSION_REQUIRED)인 워크스페이스 요청만 골라낸다", () => {
  assert.equal(permissionDeniedWorkspaceId("/api/workspaces/ws_1/wiki/ingest", 403, "WORKSPACE_PERMISSION_REQUIRED"), "ws_1");
  assert.equal(permissionDeniedWorkspaceId("/api/workspaces/ws%201/documents?x=1", 403, "WORKSPACE_PERMISSION_REQUIRED"), "ws 1");
  assert.equal(permissionDeniedWorkspaceId("/api/workspaces/ws_1/wiki/ingest", 403, "FORBIDDEN"), null);
  assert.equal(permissionDeniedWorkspaceId("/api/workspaces/ws_1/wiki/ingest", 404, "WORKSPACE_PERMISSION_REQUIRED"), null);
  assert.equal(permissionDeniedWorkspaceId("/api/auth/me", 403, "WORKSPACE_PERMISSION_REQUIRED"), null);
});

test("구독한 화면에 거절된 워크스페이스를 알리고 구독을 끊으면 더 알리지 않는다", () => {
  const received = [];
  const unsubscribe = subscribeWorkspacePermissionDenied((workspaceId) => received.push(workspaceId));
  notifyWorkspacePermissionDenied("ws_1");
  unsubscribe();
  notifyWorkspacePermissionDenied("ws_2");
  assert.deepEqual(received, ["ws_1"]);
});

test("같은 워크스페이스 신호는 짧은 시간 안에 한 번으로 합치고, 시간이 지나면 다시 알린다", () => {
  const received = [];
  const unsubscribe = subscribeWorkspacePermissionDenied((workspaceId) => received.push(workspaceId));
  notifyWorkspacePermissionDenied("ws_burst", 1_000);
  notifyWorkspacePermissionDenied("ws_burst", 1_100);
  notifyWorkspacePermissionDenied("ws_other", 1_100);
  notifyWorkspacePermissionDenied("ws_burst", 1_000 + PERMISSION_SIGNAL_COALESCE_MS);
  unsubscribe();
  assert.deepEqual(received, ["ws_burst", "ws_other", "ws_burst"]);
});

test("같은 key로 구독한 여러 화면(같은 역할 조회)에는 신호 하나에 한 번만 알린다", () => {
  const calls = [];
  const unsubscribers = [
    subscribeWorkspacePermissionDenied(() => calls.push("a"), "members:ws_key"),
    subscribeWorkspacePermissionDenied(() => calls.push("b"), "members:ws_key"),
    subscribeWorkspacePermissionDenied(() => calls.push("c"))
  ];
  notifyWorkspacePermissionDenied("ws_key", 50_000);
  unsubscribers[0]();
  notifyWorkspacePermissionDenied("ws_key", 60_000);
  unsubscribers.slice(1).forEach((unsubscribe) => unsubscribe());
  assert.deepEqual(calls, ["a", "c", "b", "c"]);
});
