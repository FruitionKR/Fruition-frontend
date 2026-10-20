import assert from "node:assert/strict";
import test from "node:test";

const {
  getWorkspaceGoneVersion,
  isRequestToGoneWorkspace,
  isWorkspaceGone,
  isWorkspaceGoneResponse,
  markWorkspaceGone,
  resetWorkspaceGone,
  subscribeWorkspaceGone,
  workspaceIdFromPath
} = await import("../src/shared/lib/workspaceAccess.ts");

test("워크스페이스 하위 경로에서 워크스페이스 id를 읽는다", () => {
  assert.equal(workspaceIdFromPath("/api/workspaces/ws_1/document-tree"), "ws_1");
  assert.equal(workspaceIdFromPath("/api/workspaces/ws_1"), "ws_1");
  assert.equal(workspaceIdFromPath("/api/workspaces/ws_1?x=1"), "ws_1");
  assert.equal(workspaceIdFromPath("/api/workspaces/ws%201/wiki/graph"), "ws 1");
  assert.equal(workspaceIdFromPath("/api/workspaces"), null);
  assert.equal(workspaceIdFromPath("/api/auth/me"), null);
});

test("선택한 워크스페이스 조회의 404 WORKSPACE_NOT_FOUND만 접근 불가로 본다", () => {
  const base = { path: "/api/workspaces/ws_1/ai-operation-logs", method: "GET", status: 404, code: "WORKSPACE_NOT_FOUND", selectedWorkspaceId: "ws_1" };
  assert.equal(isWorkspaceGoneResponse(base), true);
  assert.equal(isWorkspaceGoneResponse({ ...base, method: undefined }), true, "method가 없으면 GET이다");
  // OWNER 전용 변경을 멤버가 보내도 같은 404가 오므로 변경 요청으로는 판단하지 않는다.
  assert.equal(isWorkspaceGoneResponse({ ...base, method: "PATCH" }), false);
  assert.equal(isWorkspaceGoneResponse({ ...base, code: "DOCUMENT_NOT_FOUND" }), false);
  assert.equal(isWorkspaceGoneResponse({ ...base, status: 403, code: "WORKSPACE_ACCESS_DENIED" }), false);
  // 다른 워크스페이스(휴지통 복구 등) 응답은 지금 화면과 상관없다.
  assert.equal(isWorkspaceGoneResponse({ ...base, path: "/api/workspaces/ws_2/document-tree" }), false);
  assert.equal(isWorkspaceGoneResponse({ ...base, selectedWorkspaceId: null }), false);
});

test("접근 불가로 기록되면 구독자에게 알리고 그 워크스페이스로 가는 요청만 막는다", () => {
  resetWorkspaceGone();
  let notified = 0;
  const unsubscribe = subscribeWorkspaceGone(() => { notified += 1; });
  const before = getWorkspaceGoneVersion();
  assert.equal(isWorkspaceGone("ws_1"), false);
  markWorkspaceGone("ws_1");
  markWorkspaceGone("ws_1");
  assert.equal(notified, 1, "같은 워크스페이스는 한 번만 알린다");
  assert.notEqual(getWorkspaceGoneVersion(), before);
  assert.equal(isWorkspaceGone("ws_1"), true);
  assert.equal(isWorkspaceGone(null), false);
  assert.equal(isRequestToGoneWorkspace("/api/workspaces/ws_1/wiki/graph"), true);
  assert.equal(isRequestToGoneWorkspace("/api/workspaces/ws_2/wiki/graph"), false);
  assert.equal(isRequestToGoneWorkspace("/api/workspaces"), false, "목록 조회는 막지 않는다(다른 워크스페이스로 옮길 때 쓴다)");
  unsubscribe();
  resetWorkspaceGone();
});
