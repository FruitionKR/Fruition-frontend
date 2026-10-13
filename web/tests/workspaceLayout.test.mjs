import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canShowAgentPanel, isAgentPanelVisible } from "../src/widgets/workspace/lib/agentPanelVisibility.ts";
import { focusGraphNode } from "../src/widgets/workspace/lib/focusGraphNode.ts";

const sidebarProfilePath = new URL(
  "../src/widgets/document-sidebar/ui/SidebarProfile.tsx",
  import.meta.url
);
const settingsModalPath = new URL(
  "../src/features/user-settings/ui/SettingsModal.tsx",
  import.meta.url
);
const documentSidebarPath = new URL(
  "../src/widgets/document-sidebar/ui/DocumentSidebar.tsx",
  import.meta.url
);
const notificationsIndexPath = new URL(
  "../src/features/document-notifications/index.ts",
  import.meta.url
);
const noticeBusPath = new URL(
  "../src/features/document-notifications/model/noticeBus.ts",
  import.meta.url
);

test("그래프 뷰에서도 채팅 패널을 띄운다", () => {
  assert.equal(canShowAgentPanel("graph"), true);
  assert.equal(isAgentPanelVisible("graph", true), true);
});

test("그래프 채팅은 채팅 시작 전에는 닫혀 있다", () => {
  assert.equal(isAgentPanelVisible("graph", false), false);
});

test("홈 뷰 패널 동작은 그대로 유지한다", () => {
  assert.equal(isAgentPanelVisible("home", true), true);
  assert.equal(isAgentPanelVisible("home", false), false);
});

test("로그·규칙·설정 뷰는 채팅 패널을 렌더하지 않는다", () => {
  for (const view of ["logs", "rules", "settings"]) {
    assert.equal(canShowAgentPanel(view), false);
    assert.equal(isAgentPanelVisible(view, true), false);
  }
});

test("그래프에서 패널을 닫으면 접힘으로 본다(그래프가 우측까지 확장되고 알림이 우측에 붙는다)", () => {
  assert.equal(isAgentPanelVisible("graph", false), false);
});

test("레일 프로필은 메뉴 없이 프로필 설정을 바로 열고, 로그아웃은 설정 메뉴에 있다", async () => {
  const [source, modalSource] = await Promise.all([
    readFile(sidebarProfilePath, "utf8"),
    readFile(settingsModalPath, "utf8")
  ]);

  assert.doesNotMatch(source, /Wiki 관리/);
  assert.doesNotMatch(source, /NotificationsPanel/);
  assert.doesNotMatch(source, /isNotificationsOpen/);
  // 프로필은 팝업 메뉴를 두지 않는다.
  assert.doesNotMatch(source, /role="menu"/);
  // 톱니는 기본 설정, 프로필은 프로필 설정을 연다. 소셜 연동에서 돌아오면 계정 설정을 연다.
  assert.match(source, /setSettingsSection\("preferences"\)/);
  assert.match(source, /setSettingsSection\("profile"\)/);
  assert.match(source, /setSettingsSection\("account"\)/);
  // 로그아웃은 설정 모달 메뉴에서 한다.
  assert.match(modalSource, /signOut\(\{ callLogout: true \}\)/);
  assert.match(modalSource, /<span>로그아웃<\/span>/);
});

test("프로필은 Wiki 관리에만 필요했던 프로젝트 목록을 받지 않는다", async () => {
  const [profileSource, sidebarSource] = await Promise.all([
    readFile(sidebarProfilePath, "utf8"),
    readFile(documentSidebarPath, "utf8")
  ]);

  assert.match(profileSource, /export function SidebarProfile\(\)/);
  assert.match(sidebarSource, /<SidebarProfile\s*\/>/);
  assert.doesNotMatch(sidebarSource, /<SidebarProfile\b[^>]*\bprojects\s*=/);
});

test("문서 알림 공개 API에서 Wiki 관리 패널을 제거한다", async () => {
  const [indexSource, busSource] = await Promise.all([
    readFile(notificationsIndexPath, "utf8"),
    readFile(noticeBusPath, "utf8")
  ]);

  assert.doesNotMatch(indexSource, /NotificationsPanel/);
  assert.doesNotMatch(busSource, /NoticeRecord|NoticeHistory|HISTORY_LIMIT/);
});

test("그래프 노드 클릭은 문서 선택을 유지하고 그래프 포커스만 바꾼다", () => {
  const selection = {
    focusedGraphNodeId: "concept-before",
    selectedTreeItemId: "tree-document",
    selectedPreviewTarget: { pageId: null, title: "열어 둔 문서", pageType: null },
    selectedDocumentId: "document-1"
  };

  assert.deepEqual(focusGraphNode(selection, "concept-after"), {
    ...selection,
    focusedGraphNodeId: "concept-after"
  });
});
