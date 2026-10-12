import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  AGENT_PANEL_BASE_WIDTH,
  AGENT_PANEL_LIMITS,
  clampPanelWidth,
  getAgentPanelMaxWidth,
  resolvePanelDrag,
  resolvePanelKeyStep
} from "../lib/panelResize";

type AgentPanelLayoutOptions = {
  /** 현재 뷰에서 패널이 열려 있는가(열림 여부는 HomeWorkspace가 뷰별로 가진다) */
  isShown: boolean;
  /** 화면에 보이는 사이드바 폭. 콘텐츠 최소 폭 보호에 쓴다. */
  sidebarWidth: number;
  /** 최소 폭 미만으로 줄이거나 Enter를 누르면 현재 뷰의 패널을 닫는다. */
  onCollapse: () => void;
};

/**
 * 오른쪽 채팅 패널 폭. 왼쪽 가장자리 핸들을 pointer capture로 끌고(왼쪽으로 끌면 넓어짐),
 * 최소 폭 미만이면 패널을 닫는다. 폭은 열려 있는 동안만 유지하고, 닫히면(어떤 경로든) 기본 폭으로 돌려
 * 다시 열 때 항상 360(100%)으로 시작한다. 그래서 localStorage에도 저장하지 않는다.
 */
export function useAgentPanelLayout({ isShown, sidebarWidth, onCollapse }: AgentPanelLayoutOptions) {
  const [width, setWidth] = useState(AGENT_PANEL_BASE_WIDTH);
  // 창 폭에 따른 최대 폭. 값이 같으면 React가 리렌더를 건너뛰므로 넓은 창에서는 resize마다 그리지 않는다.
  const [maxWidth, setMaxWidth] = useState(AGENT_PANEL_LIMITS.max);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const limits = { min: AGENT_PANEL_LIMITS.min, max: maxWidth };
  const visibleWidth = isShown ? clampPanelWidth(width, limits) : 0;

  // 패널이 닫히면 폭을 기본값으로 돌린다. 페인트 전에 처리해 다시 열 때 이전 폭이 한 프레임도 보이지 않게 한다.
  useLayoutEffect(() => {
    if (!isShown) setWidth(AGENT_PANEL_BASE_WIDTH);
  }, [isShown]);

  useLayoutEffect(() => {
    const syncMaxWidth = () => setMaxWidth(getAgentPanelMaxWidth(window.innerWidth, sidebarWidth));
    syncMaxWidth();
    window.addEventListener("resize", syncMaxWidth);
    return () => window.removeEventListener("resize", syncMaxWidth);
  }, [sidebarWidth]);

  function endDrag() {
    dragRef.current = null;
    setIsDragging(false);
  }

  function start(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: visibleWidth };
    setIsDragging(true);
  }

  function resolveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    // 패널이 오른쪽에 붙어 있어 왼쪽으로 끌수록(clientX 감소) 넓어진다.
    return resolvePanelDrag(drag.startWidth - (event.clientX - drag.startX), { isCollapsed: false, width: drag.startWidth }, limits);
  }

  /** 접히면 드래그를 끝내고 패널을 닫는다(핸들도 함께 사라지고, 폭은 닫힘 처리에서 기본값으로 돌아간다). */
  function collapseFromDrag() {
    endDrag();
    onCollapse();
  }

  function update(event: ReactPointerEvent<HTMLElement>): boolean {
    const next = resolveDrag(event);
    if (!next) return false;
    if (next.isCollapsed) collapseFromDrag();
    else setWidth(next.width);
    return true;
  }

  function stop(event: ReactPointerEvent<HTMLElement>): boolean {
    const next = resolveDrag(event);
    if (!next) return false;
    // pointercancel은 좌표를 믿을 수 없어 마지막으로 그린 폭을 그대로 둔다.
    if (event.type !== "pointercancel" && next.isCollapsed) {
      collapseFromDrag();
      return true;
    }
    endDrag();
    if (event.type !== "pointercancel") setWidth(next.width);
    return true;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = resolvePanelKeyStep({ isCollapsed: false, width: visibleWidth }, event.key === "ArrowLeft" ? 1 : -1, limits);
      if (next.isCollapsed) onCollapse();
      else setWidth(next.width);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onCollapse();
    }
  }

  return {
    /** 화면에 보이는 폭(--agent-panel-width). 닫혀 있으면 0이다. */
    visibleWidth,
    /** 현재 창에서 허용하는 최대 폭 */
    maxWidth,
    isDragging,
    start,
    update,
    stop,
    handleKeyDown
  };
}
