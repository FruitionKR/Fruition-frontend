import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import { useSidebarLayout } from "./useSidebarLayout";
import { useAgentPanelLayout } from "./useAgentPanelLayout";
import { useCompactLayout } from "./useCompactLayout";
import { writePanelWidths } from "./panelWidthPreview";
import { SIDEBAR_BASE_WIDTH, SIDEBAR_RAIL_WIDTH } from "../lib/panelResize";
import { isAgentPanelVisible } from "../lib/workspaceLayout";

/**
 * 사이드바·채팅 패널의 열림/폭/좁은 화면 겹침을 한곳에서 조합한다.
 * 드래그 중 폭은 React 상태 대신 main의 CSS 변수로 바로 그린다(panelStyle과 같은 변수·같은 계산).
 */
export function useWorkspacePanels({ activeView, locationKey }: { activeView: RailView; locationKey: string }) {
  const [isHomeAgentPanelOpen, setIsHomeAgentPanelOpen] = useState(true);
  const [isGraphAgentPanelOpen, setIsGraphAgentPanelOpen] = useState(false);
  const isGraphView = activeView === "graph";
  const sidebarLayout = useSidebarLayout();
  // 좁은 화면이면 겹쳐 여는 채팅 패널 폭(넓은 화면이면 null). 좁은 화면에서는 두 패널이 콘텐츠를 밀지 않고 위에 겹친다.
  const compactAgentPanelWidth = useCompactLayout();
  const isCompactLayout = compactAgentPanelWidth !== null;
  // 좁은 화면에서 겹쳐 연 사이드바. 넓은 화면의 접힘 상태(저장 값)는 건드리지 않고, 다른 화면·문서로 이동하면 닫는다.
  const [isCompactSidebarOpen, setIsCompactSidebarOpen] = useState(false);
  const isSidebarCollapsed = isCompactLayout ? !isCompactSidebarOpen : sidebarLayout.isCollapsed;
  useEffect(() => {
    setIsCompactSidebarOpen(false);
  }, [locationKey, isCompactLayout]);
  // 좁은 화면이 되면 채팅 패널이 문서를 덮지 않게 닫아 둔다. 런처 버튼으로 다시 연다.
  useEffect(() => {
    if (!isCompactLayout) return;
    setIsHomeAgentPanelOpen(false);
    setIsGraphAgentPanelOpen(false);
  }, [isCompactLayout]);
  // 콘텐츠 왼쪽 여백. 좁은 화면에서는 레일만 피한다.
  const contentLeft = isCompactLayout ? SIDEBAR_RAIL_WIDTH : sidebarLayout.visibleWidth;

  // 현재 뷰(홈/그래프)에서 패널이 열려 있는지. 패널이 없는 화면으로 가도 이 값은 유지돼 패널을 숨긴 채 살려 둔다.
  const isAgentPanelOpen = isGraphView ? isGraphAgentPanelOpen : isHomeAgentPanelOpen;
  // 패널이 실제로 화면에 있는지. 렌더 조건·그래프 우측 여백·알림 위치가 모두 이 값을 기준으로 한다.
  const isAgentPanelShown = isAgentPanelVisible(activeView, isAgentPanelOpen);
  const agentPanelLayout = useAgentPanelLayout({
    isShown: isAgentPanelShown,
    sidebarWidth: sidebarLayout.visibleWidth,
    onCollapse: closeAgentPanel
  });
  // 콘텐츠 오른쪽 여백과 채팅 패널 자체 폭. 좁은 화면에서는 패널이 콘텐츠 위에 겹치므로 콘텐츠는 오른쪽 끝까지 쓴다.
  const contentRight = isCompactLayout ? 0 : agentPanelLayout.visibleWidth;
  const agentPanelSelfWidth = isAgentPanelShown && isCompactLayout ? compactAgentPanelWidth : agentPanelLayout.visibleWidth;

  // 좁은 화면에서는 두 패널이 콘텐츠를 밀지 않고 겹치므로 핸들도 없고 미리 그릴 것도 없다.
  const workspaceRef = useRef<HTMLElement>(null);
  function previewSidebarWidth(width: number) {
    if (!isCompactLayout) writePanelWidths(workspaceRef.current, { "--sidebar-width": width, "--sidebar-self-width": width });
  }
  function previewAgentPanelWidth(width: number) {
    if (!isCompactLayout) writePanelWidths(workspaceRef.current, { "--agent-panel-width": width, "--agent-panel-self-width": width });
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const sidebarWidth = sidebarLayout.update(event);
    if (sidebarWidth !== null) return previewSidebarWidth(sidebarWidth);
    const agentPanelWidth = agentPanelLayout.update(event);
    if (agentPanelWidth !== null) previewAgentPanelWidth(agentPanelWidth);
  }

  function handleResizePointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const sidebarWidth = sidebarLayout.stop(event);
    if (sidebarWidth !== null) return previewSidebarWidth(sidebarWidth);
    const agentPanelWidth = agentPanelLayout.stop(event);
    if (agentPanelWidth !== null) previewAgentPanelWidth(agentPanelWidth);
  }

  function expandSidebar() {
    if (isCompactLayout) setIsCompactSidebarOpen(true);
    else if (sidebarLayout.isCollapsed) sidebarLayout.expand();
  }

  function collapseSidebar() {
    if (isCompactLayout) setIsCompactSidebarOpen(false);
    else sidebarLayout.collapse();
  }

  /** 현재 뷰(홈/그래프)의 채팅 패널을 닫는다. 헤더 숨기기 버튼과 폭 조절 핸들 접기가 함께 쓴다. */
  function closeAgentPanel() {
    if (isGraphView) setIsGraphAgentPanelOpen(false);
    else setIsHomeAgentPanelOpen(false);
  }

  /** 현재 뷰(홈/그래프)의 채팅 패널을 연다(우하단 런처 버튼). */
  function openAgentPanel() {
    if (isGraphView) setIsGraphAgentPanelOpen(true);
    else setIsHomeAgentPanelOpen(true);
  }

  /** 홈 화면의 채팅 패널을 연다(스킬 실행이 문서를 열며 함께 연다). */
  function openHomeAgentPanel() {
    setIsHomeAgentPanelOpen(true);
  }

  const panelStyle = {
    "--sidebar-width": `${contentLeft}px`,
    "--sidebar-self-width": `${isCompactLayout ? (isCompactSidebarOpen ? SIDEBAR_BASE_WIDTH : SIDEBAR_RAIL_WIDTH) : sidebarLayout.visibleWidth}px`,
    "--agent-panel-width": `${contentRight}px`,
    "--agent-panel-self-width": `${agentPanelSelfWidth}px`
  } as CSSProperties;

  return {
    workspaceRef,
    panelStyle,
    sidebarLayout,
    agentPanelLayout,
    isCompactLayout,
    isCompactSidebarOpen,
    isSidebarCollapsed,
    isPanelResizing: sidebarLayout.isDragging || agentPanelLayout.isDragging,
    isAgentPanelOpen,
    isAgentPanelShown,
    handleResizePointerMove,
    handleResizePointerEnd,
    expandSidebar,
    collapseSidebar,
    closeAgentPanel,
    openAgentPanel,
    openHomeAgentPanel
  };
}
