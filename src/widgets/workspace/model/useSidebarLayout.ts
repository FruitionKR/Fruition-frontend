import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_SIDEBAR_STATE,
  SIDEBAR_BASE_WIDTH,
  SIDEBAR_LIMITS,
  SIDEBAR_STORAGE_KEY,
  collapsePanel,
  expandPanel,
  getSidebarVisibleWidth,
  parseStoredPanelState,
  resolvePanelDrag,
  resolvePanelKeyStep,
  type PanelState
} from "../lib/panelResize";
import { readStoredPanel, writeStoredPanel } from "./panelStorage";
import { usePointerDrag } from "./usePointerDrag";

/**
 * 왼쪽 사이드바 폭·접힘 상태. 핸들을 pointer capture로 끌고, 드래그 중 최소 폭 미만이면 레일만 남기고 접는다.
 * 펼치기 버튼은 항상 기본 폭(300)으로 펼치고, 접힌 레일을 끌어 펼치면 드래그 위치 폭을 쓴다.
 * 드래그 중에는 React 상태를 바꾸지 않고 update()가 돌려준 폭을 호출부가 CSS 변수로 그린다(접힘 전환만 예외).
 * 상태는 드래그 종료·토글 시 localStorage에 저장한다.
 * 첫 렌더는 SSR과 같은 기본값이고, 마운트 직후(페인트 전) 저장 값을 복원한다.
 */
export function useSidebarLayout() {
  const [state, setState] = useState<PanelState>(DEFAULT_SIDEBAR_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const drag = usePointerDrag<PanelState>();
  // 드래그 중 마지막으로 그린 상태. pointercancel은 좌표를 믿을 수 없어 이 값을 확정한다.
  const previewRef = useRef<PanelState | null>(null);

  useLayoutEffect(() => {
    setState(parseStoredPanelState(readStoredPanel(SIDEBAR_STORAGE_KEY), SIDEBAR_LIMITS, DEFAULT_SIDEBAR_STATE));
  }, []);

  function commit(next: PanelState) {
    setState(next);
    writeStoredPanel(SIDEBAR_STORAGE_KEY, next);
  }

  function start(event: ReactPointerEvent<HTMLElement>) {
    previewRef.current = null;
    drag.start(event, stateRef.current);
  }

  function resolveDrag(event: ReactPointerEvent<HTMLElement>) {
    const result = drag.resolve(event);
    if (!result) return null;
    return resolvePanelDrag(getSidebarVisibleWidth(result.base) + result.deltaX, result.base, SIDEBAR_LIMITS);
  }

  /** 드래그 중 보이는 폭(px). 접힘이 바뀌면 클래스가 바뀌어야 하므로 그때만 상태를 갱신한다. 이 드래그의 이벤트가 아니면 null. */
  function update(event: ReactPointerEvent<HTMLElement>): number | null {
    const next = resolveDrag(event);
    if (!next) return null;
    previewRef.current = next;
    if (next.isCollapsed !== stateRef.current.isCollapsed) setState(next);
    return getSidebarVisibleWidth(next);
  }

  /** 드래그를 끝내고 확정한 폭(px)을 돌려준다. 이 드래그의 이벤트가 아니면 null. */
  function stop(event: ReactPointerEvent<HTMLElement>): number | null {
    const next = resolveDrag(event);
    if (!next) return null;
    drag.end();
    const committed = event.type === "pointercancel" ? (previewRef.current ?? stateRef.current) : next;
    previewRef.current = null;
    commit(committed);
    return getSidebarVisibleWidth(committed);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      commit(resolvePanelKeyStep(stateRef.current, event.key === "ArrowRight" ? 1 : -1, SIDEBAR_LIMITS));
    } else if (event.key === "Enter") {
      event.preventDefault();
      toggle();
    }
  }

  function collapse() {
    commit(collapsePanel(stateRef.current));
  }

  function expand() {
    commit(expandPanel(SIDEBAR_BASE_WIDTH));
  }

  function toggle() {
    if (stateRef.current.isCollapsed) expand();
    else collapse();
  }

  return {
    isCollapsed: state.isCollapsed,
    /** 화면에 보이는 폭(--sidebar-width). 접히면 레일 폭이다. */
    visibleWidth: getSidebarVisibleWidth(state),
    /** 드래그 중이면 콘텐츠 iframe이 포인터를 가로채지 않게 막는 데 쓴다. */
    isDragging: drag.isDragging,
    start,
    update,
    stop,
    handleKeyDown,
    collapse,
    expand
  };
}
