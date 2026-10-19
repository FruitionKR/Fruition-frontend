import assert from "node:assert/strict";
import test from "node:test";

const {
  INITIAL_SKILL_EDITOR_TABS,
  SKILL_LIST_TAB_ID,
  activateTab,
  closeTab,
  detailTabId,
  openCreateTab,
  openCreateTabForRequest,
  openDetailTab,
  pruneDetailTabs
} = await import("../src/widgets/skills-view/lib/skillEditorTabs.ts");

test("작업 탭 '이 요청을 스킬로 저장'은 요청으로 채운 새 스킬 탭을 열고, 같은 요청이면 그 탭으로만 간다", () => {
  const opened = openCreateTabForRequest(INITIAL_SKILL_EDITOR_TABS, "  문서를 주제별 폴더로 정리해줘 ");
  assert.deepEqual(opened.tabs, [{ id: "create-1", kind: "create", prefillRequest: "문서를 주제별 폴더로 정리해줘" }]);
  assert.equal(opened.activeId, "create-1");

  const listed = activateTab(opened, SKILL_LIST_TAB_ID);
  const again = openCreateTabForRequest(listed, "문서를 주제별 폴더로 정리해줘");
  assert.equal(again.tabs.length, 1);
  assert.equal(again.activeId, "create-1");

  const other = openCreateTabForRequest(again, "회의록을 요약해줘");
  assert.deepEqual(other.tabs.map((tab) => tab.id), ["create-1", "create-2"]);
  assert.equal(other.activeId, "create-2");

  // 빈 요청은 채우지 않은 새 스킬 탭이다.
  assert.deepEqual(openCreateTabForRequest(INITIAL_SKILL_EDITOR_TABS, "  ").tabs, [{ id: "create-1", kind: "create" }]);
});

test("처음에는 스킬 목록 탭만 있다", () => {
  assert.deepEqual(INITIAL_SKILL_EDITOR_TABS.tabs, []);
  assert.equal(INITIAL_SKILL_EDITOR_TABS.activeId, SKILL_LIST_TAB_ID);
});

test("'+'는 누를 때마다 새 스킬 탭을 열고 그 탭으로 간다", () => {
  const once = openCreateTab(INITIAL_SKILL_EDITOR_TABS);
  const twice = openCreateTab(once);
  assert.equal(twice.tabs.length, 2);
  assert.notEqual(twice.tabs[0].id, twice.tabs[1].id);
  assert.equal(twice.activeId, twice.tabs[1].id);
});

test("Agent 요청으로 연 새 스킬 탭은 요청을 들고 있다", () => {
  const state = openCreateTab(INITIAL_SKILL_EDITOR_TABS, "연구 개요를 핵심만 3문장으로 정리해 줘");
  assert.equal(state.tabs[0].prefillRequest, "연구 개요를 핵심만 3문장으로 정리해 줘");
});

test("같은 스킬의 상세 탭은 하나만 열고, 다시 열면 그 탭으로 간다", () => {
  const opened = openDetailTab(INITIAL_SKILL_EDITOR_TABS, "s1");
  const back = activateTab(opened, SKILL_LIST_TAB_ID);
  const again = openDetailTab(back, "s1");
  assert.equal(again.tabs.length, 1);
  assert.equal(again.activeId, detailTabId("s1"));
});

test("보던 탭을 닫으면 오른쪽, 없으면 왼쪽, 그것도 없으면 목록으로 간다", () => {
  let state = openDetailTab(openDetailTab(openCreateTab(INITIAL_SKILL_EDITOR_TABS), "a"), "b");
  const [create, a, b] = state.tabs.map((tab) => tab.id);
  state = activateTab(state, a);
  state = closeTab(state, a);
  assert.equal(state.activeId, b);
  state = closeTab(state, b);
  assert.equal(state.activeId, create);
  state = closeTab(state, create);
  assert.equal(state.activeId, SKILL_LIST_TAB_ID);
});

test("다른 탭을 닫으면 지금 탭을 유지하고, 없는 탭은 무시한다", () => {
  const state = openCreateTab(openDetailTab(INITIAL_SKILL_EDITOR_TABS, "a"));
  const closed = closeTab(state, detailTabId("a"));
  assert.equal(closed.activeId, state.activeId);
  assert.equal(closeTab(state, "nope"), state);
  assert.equal(activateTab(state, "nope"), state);
});

test("목록에서 사라진 스킬의 상세 탭을 닫고, 바뀐 게 없으면 같은 상태다", () => {
  const state = openDetailTab(openDetailTab(INITIAL_SKILL_EDITOR_TABS, "a"), "b");
  const pruned = pruneDetailTabs(state, ["a"]);
  assert.deepEqual(pruned.tabs.map((tab) => tab.id), [detailTabId("a")]);
  assert.equal(pruned.activeId, detailTabId("a"));
  assert.equal(pruneDetailTabs(state, ["a", "b"]), state);
});
