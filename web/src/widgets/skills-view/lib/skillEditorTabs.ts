/**
 * 스킬 화면 편집 탭 모델. 맨 앞 '스킬'(목록) 탭은 늘 있고, 그 뒤로 새 스킬·스킬 상세 탭이 열린다.
 * 탭을 바꿔도 입력이 남도록 편집 탭은 닫을 때까지 유지한다.
 */

export const SKILL_LIST_TAB_ID = "list";

export type SkillEditorTab =
  | { id: string; kind: "create"; prefillRequest?: string }
  | { id: string; kind: "detail"; skillId: string };

export interface SkillEditorTabsState {
  tabs: readonly SkillEditorTab[];
  /** SKILL_LIST_TAB_ID 또는 편집 탭 id */
  activeId: string;
  /** 새 스킬 탭 id를 만들 때 쓰는 일련번호 */
  nextCreateSeq: number;
}

export const INITIAL_SKILL_EDITOR_TABS: SkillEditorTabsState = { tabs: [], activeId: SKILL_LIST_TAB_ID, nextCreateSeq: 1 };

/** 새 스킬 탭을 열고 그 탭으로 간다. 누를 때마다 새 탭이다. */
export function openCreateTab(state: SkillEditorTabsState, prefillRequest?: string): SkillEditorTabsState {
  const id = `create-${state.nextCreateSeq}`;
  const tab: SkillEditorTab = prefillRequest ? { id, kind: "create", prefillRequest } : { id, kind: "create" };
  return { tabs: [...state.tabs, tab], activeId: id, nextCreateSeq: state.nextCreateSeq + 1 };
}

/**
 * 작업 탭의 "이 요청을 스킬로 저장"(Figma 1671:13245)으로 새 스킬 탭을 연다.
 * 같은 요청으로 채운 새 스킬 탭이 이미 있으면 그 탭으로만 간다(같은 버튼을 다시 눌러도 탭이 쌓이지 않게).
 */
export function openCreateTabForRequest(state: SkillEditorTabsState, request: string): SkillEditorTabsState {
  const prefillRequest = request.trim();
  if (!prefillRequest) return openCreateTab(state);
  const existing = state.tabs.find((tab) => tab.kind === "create" && tab.prefillRequest === prefillRequest);
  return existing ? { ...state, activeId: existing.id } : openCreateTab(state, prefillRequest);
}

export function detailTabId(skillId: string): string {
  return `detail-${skillId}`;
}

/** 스킬 상세 탭을 연다. 이미 열려 있으면 그 탭으로만 간다(입력 유지). */
export function openDetailTab(state: SkillEditorTabsState, skillId: string): SkillEditorTabsState {
  const id = detailTabId(skillId);
  if (state.tabs.some((tab) => tab.id === id)) return { ...state, activeId: id };
  return { ...state, tabs: [...state.tabs, { id, kind: "detail", skillId }], activeId: id };
}

export function activateTab(state: SkillEditorTabsState, id: string): SkillEditorTabsState {
  if (id !== SKILL_LIST_TAB_ID && !state.tabs.some((tab) => tab.id === id)) return state;
  return { ...state, activeId: id };
}

/**
 * 탭을 닫는다. 보던 탭을 닫으면 오른쪽 이웃(없으면 왼쪽, 그것도 없으면 목록)으로 간다.
 * 다른 탭을 닫으면 지금 탭을 그대로 둔다.
 */
export function closeTab(state: SkillEditorTabsState, id: string): SkillEditorTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { ...state, tabs };
  const neighbor = tabs[index] ?? tabs[index - 1];
  return { ...state, tabs, activeId: neighbor?.id ?? SKILL_LIST_TAB_ID };
}

/** 목록에서 사라진 스킬(다른 곳에서 삭제 등)의 상세 탭을 닫는다. 바뀐 게 없으면 같은 상태를 돌려준다. */
export function pruneDetailTabs(state: SkillEditorTabsState, skillIds: readonly string[]): SkillEditorTabsState {
  const known = new Set(skillIds);
  return state.tabs
    .filter((tab) => tab.kind === "detail" && !known.has(tab.skillId))
    .reduce((current, tab) => closeTab(current, tab.id), state);
}
