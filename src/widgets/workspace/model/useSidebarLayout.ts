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

/**
 * 왼쪽 사이드바 폭·접힘 상태. useResizeHandle과 같은 pointer capture 패턴으로 드래그하고,
 * 드래그 중 최소 폭 미만이면 레일만 남기고 접는다. 펼치기 버튼은 항상 기본 폭(300)으로 펼치고,
 * 접힌 레일을 끌어 펼치면 드래그 위치 폭을 쓴다. 상태는 드래그 종료·토글 시 localStorage에 저장한다.
 * 첫 렌더는 SSR과 같은 기본값이고, 마운트 직후(페인트 전) 저장 값을 복원한다.
 */
export function useSidebarLayout() {
  const [state, setState] = useState<PanelState>(DEFAULT_SIDEBAR_STATE);
  const [isDragging, setIsDragging] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dragRef = useRef<{ pointerId: number; startX: number; base: PanelState } | null>(null);

  useLayoutEffect(() => {
    setState(parseStoredPanelState(readStoredPanel(SIDEBAR_STORAGE_KEY), SIDEBAR_LIMITS, DEFAULT_SIDEBAR_STATE));
  }, []);

  function commit(next: PanelState) {
    setState(next);
    writeStoredPanel(SIDEBAR_STORAGE_KEY, next);
  }

  function start(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, base: stateRef.current };
    setIsDragging(true);
  }

  function resolveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    return resolvePanelDrag(getSidebarVisibleWidth(drag.base) + event.clientX - drag.startX, drag.base, SIDEBAR_LIMITS);
  }

  function update(event: ReactPointerEvent<HTMLElement>): boolean {
    const next = resolveDrag(event);
    if (!next) return false;
    // 같은 결과면 이전 객체를 그대로 둬 리렌더를 건너뛴다(접힌 채로 끄는 동안 등).
    setState((current) => current.isCollapsed === next.isCollapsed && current.width === next.width ? current : next);
    return true;
  }

  function stop(event: ReactPointerEvent<HTMLElement>): boolean {
    const next = resolveDrag(event);
    if (!next) return false;
    dragRef.current = null;
    setIsDragging(false);
    // pointercancel은 좌표를 믿을 수 없어 마지막으로 그린 상태를 확정한다.
    commit(event.type === "pointercancel" ? stateRef.current : next);
    return true;
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
    isDragging,
    start,
    update,
    stop,
    handleKeyDown,
    collapse,
    expand
  };
}
