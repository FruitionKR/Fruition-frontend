import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Node 테스트에서도 앱의 TypeScript 경로 별칭을 같은 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { ApiError, getErrorMessage, isWorkspacePermissionRequiredError } = await import("../src/shared/lib/apiErrors.ts");
const { ALL_WORKSPACE_PERMISSIONS, findRequiredPermission, workspacePermissionLabel } = await import("../src/shared/lib/workspacePermissions.ts");
const { updateMemberPermissions } = await import("../src/entities/workspace/api/members.ts");
const { updateWorkspaceAutoIngest } = await import("../src/entities/workspace/api/workspace.ts");

const member = { user_id: "user_2", email: "m@example.com", display_name: "멤버", provider: "local", role: "MEMBER", permissions: ["wiki.ingest", "wiki.lint"], joined_at: "2026-10-01T00:00:00Z" };

test("권한 항목은 access #32의 다섯 값이고 라벨이 있다", () => {
  assert.deepEqual([...ALL_WORKSPACE_PERMISSIONS], ["wiki.ingest", "wiki.lint", "skill.author", "wiki.restore", "document.convert"]);
  assert.equal(workspacePermissionLabel("wiki.ingest"), "위키 편입");
  // 모르는 값은 그대로 보여 준다.
  assert.equal(workspacePermissionLabel("wiki.unknown"), "wiki.unknown");
});

test("권한 항목 변경은 PATCH members/{user_id}에 permissions 전체를 보낸다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ ...member, permissions: ["wiki.ingest", "wiki.lint"] });
  });
  const updated = await updateMemberPermissions("ws_1", "user_2", ["wiki.lint", "wiki.ingest"]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/workspaces/ws_1/members/user_2"));
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), { permissions: ["wiki.lint", "wiki.ingest"] });
  assert.deepEqual(updated.permissions, ["wiki.ingest", "wiki.lint"]);
});

test("OWNER에게 permissions를 보내면 400 OWNER_PERMISSIONS_FIXED가 code를 가진 ApiError로 온다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { code: "OWNER_PERMISSIONS_FIXED", message: "OWNER의 권한 항목은 바꿀 수 없습니다." } },
    { status: 400 }
  ));
  const error = await updateMemberPermissions("ws_1", "user_owner", ["wiki.ingest"]).catch((cause) => cause);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 400);
  assert.equal(error.code, "OWNER_PERMISSIONS_FIXED");
  assert.equal(getErrorMessage(error, "실패"), "OWNER의 권한 항목은 바꿀 수 없습니다.");
});

test("자동 편입 토글은 PATCH workspaces/{id}에 auto_ingest_on_upload만 보낸다", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ id: "ws_1", name: "팀", icon_emoji: null, icon_url: null, auto_ingest_on_upload: true, created_at: "", updated_at: "" });
  });
  const workspace = await updateWorkspaceAutoIngest("ws_1", true);
  assert.ok(calls[0].url.endsWith("/api/workspaces/ws_1"));
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), { auto_ingest_on_upload: true });
  assert.equal(workspace.auto_ingest_on_upload, true);
});

test("403 WORKSPACE_PERMISSION_REQUIRED는 필요한 권한 라벨과 OWNER 요청 안내로 바꾼다(document #116)", () => {
  const denied = new ApiError("권한 'wiki.ingest'이(가) 필요합니다.", 403, "WORKSPACE_PERMISSION_REQUIRED");
  assert.equal(isWorkspacePermissionRequiredError(denied), true);
  assert.equal(findRequiredPermission(denied.message), "wiki.ingest");
  assert.equal(getErrorMessage(denied, "실패"), "이 작업에는 '위키 편입' 권한이 필요합니다. 워크스페이스 OWNER에게 권한을 요청하세요.");
  // 메시지에 항목이 없어도 OWNER에게 요청하도록 안내한다.
  const bare = new ApiError("Forbidden", 403, "WORKSPACE_PERMISSION_REQUIRED");
  assert.equal(getErrorMessage(bare, "실패"), "이 작업에는 권한이 필요합니다. 워크스페이스 OWNER에게 권한을 요청하세요.");
  // 다른 403이나 다른 code는 서버 문구를 그대로 둔다.
  assert.equal(isWorkspacePermissionRequiredError(new ApiError("거절", 403, "WORKSPACE_ACCESS_DENIED")), false);
  assert.equal(getErrorMessage(new ApiError("거절", 403, "WORKSPACE_ACCESS_DENIED"), "실패"), "거절");
  assert.equal(isWorkspacePermissionRequiredError(new ApiError("거절", 400, "WORKSPACE_PERMISSION_REQUIRED")), false);
});
