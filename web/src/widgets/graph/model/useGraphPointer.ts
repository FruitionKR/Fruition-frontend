import { useRef } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import type { GraphLink, GraphNode, NodePosition } from "@/entities/wiki";
import { graphDistanceInfluence, isGraphDoubleTap } from "../lib/graphGeometry";
import { getGraphDistances, reheatGraphSimulation } from "../lib/graphPhysics";
import type { GraphSimNode, GraphSimulation } from "../lib/graphPhysics";

/** PointerEvent.buttons 비트마스크: 왼쪽 버튼 */
const PRIMARY_BUTTON_MASK = 1;
/** 터치를 뗀 뒤 브라우저가 합성 클릭을 보낼 수 있는 시간 */
const TOUCH_SYNTHETIC_CLICK_WINDOW_MS = 500;

/**
 * 노드 드래그/hover/미리보기 포인터 이벤트를 처리한다.
 * 빈 영역 pan과 wheel/핀치 줌은 d3-zoom(useGraphCanvas)이 담당한다.
 */
export function useGraphPointer({
  nodes,
  links,
  draggingNodeIdRef,
  isPointerHeldRef,
  activePointerIdRef,
  externalFocusedNodeIdRef,
  drawGraphRef,
  hitTestNode,
  getSimNode,
  getSimulation,
  canvasToGraph,
  clampPosition,
  scheduleGraphCacheWrite,
  setDraggingNodeId,
  onOpenNodePreview,
  onClearNodeFocus,
  onNodeGrab,
  setHoveredNode,
  setSelectedNode,
  stopDragging
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  draggingNodeIdRef: MutableRefObject<string | null>;
  isPointerHeldRef: MutableRefObject<boolean>;
  activePointerIdRef: MutableRefObject<number | null>;
  externalFocusedNodeIdRef: MutableRefObject<string | null>;
  drawGraphRef: MutableRefObject<() => void>;
  hitTestNode: (clientX: number, clientY: number) => GraphNode | null;
  getSimNode: (nodeId: string) => GraphSimNode | null;
  getSimulation: () => GraphSimulation | null;
  canvasToGraph: (clientX: number, clientY: number) => NodePosition | null;
  clampPosition: (position: NodePosition, nodeId?: string) => NodePosition;
  scheduleGraphCacheWrite: () => void;
  setDraggingNodeId: Dispatch<SetStateAction<string | null>>;
  onOpenNodePreview: (node: GraphNode) => void;
  onClearNodeFocus?: () => void;
  /** 노드를 눌렀을 때. 등장 연출 중이면 남은 노드를 바로 보여 준다. */
  onNodeGrab: () => void;
  setHoveredNode: (nodeId: string | null) => void;
  setSelectedNode: (nodeId: string | null) => void;
  stopDragging: (pointerId?: number) => void;
}) {
  // 노드 드래그 시작 좌표와 실제 이동 여부를 함께 추적한다.
  const nodeDragRef = useRef<{ start: { x: number; y: number }; hasMoved: boolean } | null>(null);
  // touch-action: none이라 브라우저 더블 탭(dblclick)을 기대할 수 없어 터치는 탭 간격으로 직접 판단한다.
  const lastTapRef = useRef<{ nodeId: string; at: number } | null>(null);
  const lastTouchEndRef = useRef(Number.NEGATIVE_INFINITY);

  function moveNode(event: ReactPointerEvent<HTMLDivElement>, node: GraphNode) {
    if (!isPointerHeldRef.current || activePointerIdRef.current !== event.pointerId) return;
    if (event.pointerType === "mouse" && (event.buttons & PRIMARY_BUTTON_MASK) !== PRIMARY_BUTTON_MASK) return;

    const draggedSimNode = getSimNode(node.id);
    if (!draggedSimNode) return;

    const nodeDrag = nodeDragRef.current;
    if (nodeDrag && Math.hypot(event.clientX - nodeDrag.start.x, event.clientY - nodeDrag.start.y) > 3) {
      nodeDrag.hasMoved = true;
    }

    const clampedX = Math.max(0, Math.min(window.innerWidth - 1, event.clientX));
    const clampedY = Math.max(0, Math.min(window.innerHeight - 1, event.clientY));
    const graphPosition = canvasToGraph(clampedX, clampedY);
    if (!graphPosition) return;

    const nextPosition = clampPosition(graphPosition, node.id);
    const deltaX = nextPosition.x - draggedSimNode.x;
    const deltaY = nextPosition.y - draggedSimNode.y;

    // 드래그 노드로부터의 그래프 거리에 따라 주변 노드도 함께 끌려온다.
    // 주변 노드는 화면 밖에 있을 수 있으므로 화면 영역으로 clamp하지 않는다(순간 이동 방지).
    const distances = getGraphDistances(links, node.id);
    nodes.forEach((candidate) => {
      if (candidate.id === node.id) return;
      const influence = graphDistanceInfluence(distances[candidate.id]);
      if (influence <= 0) return;
      const simNode = getSimNode(candidate.id);
      if (!simNode) return;
      simNode.x += deltaX * influence;
      simNode.y += deltaY * influence;
    });

    draggedSimNode.x = nextPosition.x;
    draggedSimNode.y = nextPosition.y;
    // 드래그 중에는 위치를 고정해 simulation이 되돌리지 못하게 한다.
    draggedSimNode.fx = nextPosition.x;
    draggedSimNode.fy = nextPosition.y;

    const graphSimulation = getSimulation();
    if (graphSimulation) reheatGraphSimulation(graphSimulation);
    scheduleGraphCacheWrite();
    drawGraphRef.current();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const hitNode = hitTestNode(event.clientX, event.clientY);
    if (hitNode) {
      onNodeGrab();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      isPointerHeldRef.current = true;
      activePointerIdRef.current = event.pointerId;
      setSelectedNode(hitNode.id);
      setHoveredNode(hitNode.id);
      setDraggingNodeId(hitNode.id);
      draggingNodeIdRef.current = hitNode.id;
      nodeDragRef.current = { start: { x: event.clientX, y: event.clientY }, hasMoved: false };
      drawGraphRef.current();
      return;
    }

    // 빈 영역 클릭은 선택 해제. pan은 d3-zoom이 처리한다.
    // 외부 포커스(사이드바·채팅에서 연 노드)도 함께 지워, 이후 데이터 갱신 때 선택이 되살아나지 않게 한다.
    setSelectedNode(null);
    externalFocusedNodeIdRef.current = null;
    onClearNodeFocus?.();
  }

  function updateNodeDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const draggedNodeId = draggingNodeIdRef.current;
    if (!draggedNodeId) return;
    const node = nodes.find((candidate) => candidate.id === draggedNodeId);
    if (node) moveNode(event, node);
  }

  function updateHover(event: ReactPointerEvent<HTMLDivElement>) {
    if (draggingNodeIdRef.current) return;
    setHoveredNode(hitTestNode(event.clientX, event.clientY)?.id ?? null);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (activePointerIdRef.current !== event.pointerId) return;

    const draggedNodeId = draggingNodeIdRef.current;
    const hasMovedDraggedNode = nodeDragRef.current?.hasMoved ?? false;
    stopDragging(event.pointerId);
    nodeDragRef.current = null;
    if (event.pointerType === "touch") lastTouchEndRef.current = event.timeStamp;
    if (event.pointerType === "touch" && event.type === "pointerup" && draggedNodeId && !hasMovedDraggedNode) {
      const tap = { nodeId: draggedNodeId, at: event.timeStamp };
      const isDoubleTap = isGraphDoubleTap(lastTapRef.current, tap);
      lastTapRef.current = isDoubleTap ? null : tap;
      const tappedNode = isDoubleTap ? nodes.find((candidate) => candidate.id === draggedNodeId) : null;
      if (tappedNode) onOpenNodePreview(tappedNode);
    }
    if (!externalFocusedNodeIdRef.current) {
      setSelectedNode(hasMovedDraggedNode ? null : hitTestNode(event.clientX, event.clientY)?.id ?? draggedNodeId ?? null);
    }
  }

  function openNodePreview(event: ReactMouseEvent<HTMLDivElement>) {
    // 터치의 두 번째 탭은 handlePointerUp이 이미 열었다. 뒤이은 합성 dblclick으로 두 번 열지 않는다.
    if (event.timeStamp - lastTouchEndRef.current < TOUCH_SYNTHETIC_CLICK_WINDOW_MS) return;
    const node = hitTestNode(event.clientX, event.clientY);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedNode(node.id);
    setHoveredNode(node.id);
    onOpenNodePreview(node);
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      updateNodeDrag(event);
      updateHover(event);
    },
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onDoubleClick: openNodePreview,
    onAuxClick: (event: ReactPointerEvent<HTMLDivElement>) => event.preventDefault(),
    onPointerLeave: () => {
      if (!draggingNodeIdRef.current) {
        setHoveredNode(null);
      }
    },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      stopDragging(event.pointerId);
      nodeDragRef.current = null;
    }
  };
}
