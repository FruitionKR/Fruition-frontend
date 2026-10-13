// 좌우 패널 폭·접힘 규칙. 왼쪽 사이드바(Figma 1527:16274 펼침 / 1539:16566 접힘)와 오른쪽 채팅 패널이 함께 쓴다.
// 기본 폭을 100%로 보고 60% 미만으로 줄이면 접고, 140%까지 넓힌다. React 없이 테스트하는 순수 함수만 둔다.

/** 이 비율(60%) 미만으로 줄이면 접는다. */
const PANEL_COLLAPSE_RATIO = 0.6;
/** 최대 폭 비율(140%) */
const PANEL_MAX_RATIO = 1.4;
/** 리사이즈 핸들 키보드 한 번 이동 폭 */
export const PANEL_KEYBOARD_STEP = 16;

/** 펼쳤을 때 허용하는 폭 범위(px) */
type PanelLimits = { min: number; max: number };

/** width는 펼쳤을 때의 폭이다. 접혀 있을 때는 의미가 없다(펼치기 버튼은 항상 기본 폭으로 펼친다). */
export type PanelState = { isCollapsed: boolean; width: number };

export function createPanelLimits(baseWidth: number): PanelLimits {
  return { min: Math.round(baseWidth * PANEL_COLLAPSE_RATIO), max: Math.round(baseWidth * PANEL_MAX_RATIO) };
}

// --- 왼쪽 사이드바 ---
/** 기본 폭(100%). 레일 53 + 문서 패널 246 + 테두리 1 */
export const SIDEBAR_BASE_WIDTH = 300;
export const SIDEBAR_LIMITS = createPanelLimits(SIDEBAR_BASE_WIDTH);
export const SIDEBAR_MIN_WIDTH = SIDEBAR_LIMITS.min;
export const SIDEBAR_MAX_WIDTH = SIDEBAR_LIMITS.max;
/** 접힌 상태 레일 폭 (Figma 1540:18686 54px) */
export const SIDEBAR_RAIL_WIDTH = 54;
export const SIDEBAR_STORAGE_KEY = "fruition.sidebar.v1";
export const DEFAULT_SIDEBAR_STATE: PanelState = { isCollapsed: false, width: SIDEBAR_BASE_WIDTH };

/** 화면에서 사이드바가 차지하는 폭(--sidebar-width). 접히면 레일 폭이다. */
export function getSidebarVisibleWidth(state: PanelState): number {
  return state.isCollapsed ? SIDEBAR_RAIL_WIDTH : state.width;
}

// --- 오른쪽 채팅 패널 ---
export const AGENT_PANEL_BASE_WIDTH = 360;
export const AGENT_PANEL_LIMITS = createPanelLimits(AGENT_PANEL_BASE_WIDTH);
/** 사이드바와 채팅 패널 사이 콘텐츠 영역에 남길 최소 폭 */
const AGENT_PANEL_MIN_CONTENT_WIDTH = 480;
/** 채팅 패널 열림 여부는 HomeWorkspace가 뷰별로 갖고, 여기서는 폭만 쓴다. 다시 열면 항상 이 폭이다. */
export const DEFAULT_AGENT_PANEL_STATE: PanelState = { isCollapsed: false, width: AGENT_PANEL_BASE_WIDTH };

/** 창이 좁을 때 콘텐츠 영역이 480px 아래로 줄지 않도록 채팅 패널 최대 폭을 줄인다(최소 폭 아래로는 줄이지 않는다). */
export function getAgentPanelMaxWidth(viewportWidth: number, sidebarWidth: number): number {
  const available = Math.floor(viewportWidth - sidebarWidth - AGENT_PANEL_MIN_CONTENT_WIDTH);
  return Math.max(AGENT_PANEL_LIMITS.min, Math.min(AGENT_PANEL_LIMITS.max, available));
}

// --- 좁은 화면 ---
/**
 * 이 폭부터 기본 사이드바·가장 좁은 채팅 패널·콘텐츠 최소 폭을 나란히 둘 수 있다.
 * 더 좁으면 콘텐츠는 레일 오른쪽을 모두 쓰고, 사이드바·채팅 패널은 콘텐츠 위에 겹쳐 연다.
 */
export const COMPACT_LAYOUT_MIN_WIDTH = SIDEBAR_BASE_WIDTH + AGENT_PANEL_LIMITS.min + AGENT_PANEL_MIN_CONTENT_WIDTH;

/** 좁은 화면이면 겹쳐 여는 채팅 패널 폭(기본 폭, 레일은 가리지 않음), 넓은 화면이면 null */
export function getCompactAgentPanelWidth(viewportWidth: number): number | null {
  if (viewportWidth >= COMPACT_LAYOUT_MIN_WIDTH) return null;
  return Math.max(0, Math.min(AGENT_PANEL_BASE_WIDTH, Math.floor(viewportWidth - SIDEBAR_RAIL_WIDTH)));
}

// --- 공통 규칙 ---
export function clampPanelWidth(width: number, limits: PanelLimits): number {
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

/** 드래그 위치 폭으로 다음 상태를 정한다. base는 드래그 시작 시점 상태이고, 최소 폭 미만이면 접는다. */
export function resolvePanelDrag(dragWidth: number, base: PanelState, limits: PanelLimits): PanelState {
  if (!Number.isFinite(dragWidth)) return base;
  if (dragWidth < limits.min) return base.isCollapsed ? base : { isCollapsed: true, width: base.width };
  return { isCollapsed: false, width: clampPanelWidth(dragWidth, limits) };
}

/** 키보드 한 칸. direction 1은 넓히기, -1은 좁히기. 접힌 상태에서 넓히기는 최소 폭으로 펼친다. */
export function resolvePanelKeyStep(state: PanelState, direction: 1 | -1, limits: PanelLimits): PanelState {
  if (state.isCollapsed) return direction > 0 ? { isCollapsed: false, width: limits.min } : state;
  return resolvePanelDrag(state.width + direction * PANEL_KEYBOARD_STEP, state, limits);
}

export function collapsePanel(state: PanelState): PanelState {
  return { isCollapsed: true, width: state.width };
}

/** 펼치기 버튼: 접기 전 폭을 이어 쓰지 않고 항상 기본 폭(100%)으로 펼친다. */
export function expandPanel(baseWidth: number): PanelState {
  return { isCollapsed: false, width: baseWidth };
}

/** 저장 값 정규화. 잘못된 필드는 fallback 값으로 둔다. */
export function normalizePanelState(value: unknown, limits: PanelLimits, fallback: PanelState): PanelState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const { isCollapsed, width } = value as Record<string, unknown>;
  return {
    isCollapsed: typeof isCollapsed === "boolean" ? isCollapsed : fallback.isCollapsed,
    width: typeof width === "number" && Number.isFinite(width) ? clampPanelWidth(width, limits) : fallback.width
  };
}

export function parseStoredPanelState(raw: string | null, limits: PanelLimits, fallback: PanelState): PanelState {
  if (raw === null) return fallback;
  try {
    return normalizePanelState(JSON.parse(raw), limits, fallback);
  } catch {
    return fallback;
  }
}
