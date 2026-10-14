import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canLeaveWorkspace, getWorkspaceMenuRole } from "../src/widgets/document-sidebar/model/workspaceMenu.ts";

const headerPath = new URL("../src/widgets/document-sidebar/ui/SidebarWorkspaceHeader.tsx", import.meta.url);

test("멤버 목록에서 본인 역할을 찾는다", () => {
  const members = [
    { user_id: "owner", role: "OWNER" },
    { user_id: "me", role: "MEMBER" }
  ];
  assert.deepEqual(getWorkspaceMenuRole(members, "me"), { role: "MEMBER", isLastOwner: false });
});

test("OWNER가 혼자면 마지막 OWNER로 보고 탈퇴를 막는다", () => {
  const menu = getWorkspaceMenuRole([{ user_id: "me", role: "OWNER" }, { user_id: "other", role: "MEMBER" }], "me");
  assert.deepEqual(menu, { role: "OWNER", isLastOwner: true });
  assert.equal(canLeaveWorkspace(menu), false);
});

test("OWNER가 둘 이상이면 OWNER도 탈퇴할 수 있다", () => {
  const menu = getWorkspaceMenuRole([{ user_id: "me", role: "OWNER" }, { user_id: "other", role: "OWNER" }], "me");
  assert.equal(menu.isLastOwner, false);
  assert.equal(canLeaveWorkspace(menu), true);
});

test("본인이 목록에 없거나 역할 확인 전이면 탈퇴를 막는다", () => {
  const menu = getWorkspaceMenuRole([{ user_id: "other", role: "OWNER" }], "me");
  assert.deepEqual(menu, { role: null, isLastOwner: false });
  assert.equal(canLeaveWorkspace(menu), false);
});

test("로그인 정보가 없으면 워크스페이스 옵션 메뉴를 열지 않는다", async () => {
  const source = await readFile(headerPath, "utf8");
  assert.match(source, /if \(!me\) return;/);
  assert.match(source, /disabled=\{!me\}/);
  assert.match(source, /disabled=\{!canLeaveWorkspace\(rowMenu\)\}/);
});
