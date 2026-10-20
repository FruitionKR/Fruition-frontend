import assert from "node:assert/strict";
import test from "node:test";

const {
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
