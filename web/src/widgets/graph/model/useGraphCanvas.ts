import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, ZoomTransform } from "d3-zoom";
import type { ZoomBehavior } from "d3-zoom";
import type { GraphRect } from "../lib/graphGeometry";
import type { GraphCache, GraphLink, GraphNode, NodePosition, NodePositionMap } from "@/entities/wiki";
import { GRAPH_CENTER, GRAPH_ZOOM, linkKey } from "@/entities/graph/lib/graphBuilder";
import { initialGraphZoom } from "../lib/graphLabelVisibility";
import { readStoredGraphCache, writeStoredGraphCache } from "./graphCache";
import { drawGraphFrame, preloadRawNodeIcon } from "../lib/graphDrawing";
import { DARK_SCHEME_QUERY } from "../lib/graphColors";
import {
  canvasToGraphPosition,
  canvasViewport,
  clampGraphPan,
  clampGraphPosition,
  clampGraphZoom,
  graphNodeBounds,
  graphToCanvasPosition,
  resizeGraphPan
} from "../lib/graphGeometry";
import {
  FIXED_NODE_SIZE,
  createGraphSimulation,
  createSourceCenteredNodePositions,
  simulationPositions,
  tickGraphSimulation
} from "../lib/graphPhysics";
import type { GraphSimNode, GraphSimulation } from "../lib/graphPhysics";
import {
  GRAPH_ENTER_MOTION,
  GRAPH_UPDATE_ALPHA,
  GRAPH_UPDATE_VELOCITY_DECAY,
  easeInOutCubic,
  entryFramesAt,
  nodeEntryFrame,
  shouldSuppressEntryGlow,
  planGraphUpdate,
  revealPan,
  scheduleNodeEntries
} from "../lib/graphEnter";
import { useUserPreferences } from "@/entities/user";
import type { GraphIngestProgressInput } from "@/features/wiki-ingest/model/graphIngestProgressInputs";
import { useGraphAnimation } from "./useGraphAnimation";
import { useGraphIngestProgress } from "./useGraphIngestProgress";
import { useGraphPointer } from "./useGraphPointer";
import { useGraphReveal } from "./useGraphReveal";

const HOVER_SMOOTHING_MS = 320;
const HOVER_SETTLE_THRESHOLD = 0.002;
const GRAPH_CACHE_DEBOUNCE_MS = 700;
/** graph cache signature의 레이아웃 버전 prefix */
const GRAPH_LAYOUT_VERSION = "d3-layout-v1";
const NO_INGEST_PROGRESS_INPUTS: readonly GraphIngestProgressInput[] = [];

export function useGraphCanvas({
  nodes = [],
  links = [],
  focusedNodeId,
  onOpenNodePreview,
  onClearNodeFocus,
  ingestProgressInputs = NO_INGEST_PROGRESS_INPUTS,
  loading = false,
  revealRequest = 0
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  focusedNodeId: string | null;
  onOpenNodePreview: (node: GraphNode) => void;
  onClearNodeFocus?: () => void;
  ingestProgressInputs?: readonly GraphIngestProgressInput[];
  /** 첫 표시 연출을 시작하기 전까지 기다릴 데이터가 남아 있으면 true */
  loading?: boolean;
  /** 값이 바뀌면 노드가 하나씩 나타나는 연출을 처음부터 다시 재생한다. */
  revealRequest?: number;
}) {
  const graphSignature = useMemo(
    () => {
      const nodeSignature = nodes.map((node) => node.id).sort().join("|");
      const linkSignature = links.map((link) => linkKey(link.from, link.to)).sort().join("|");
      return `${GRAPH_LAYOUT_VERSION}:${nodeSignature}:${linkSignature}`;
    },
    [links, nodes]
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  function isRawSourceLink(link: GraphLink) {
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    const kinds = [from?.kind, to?.kind];
    return kinds.includes("raw") && kinds.includes("source");
  }

  function nodeSize(node: GraphNode) {
    if (node.kind === "raw") return 12;
    if (node.kind === "source") return 16;
    return FIXED_NODE_SIZE;
  }

  const initialNodePositions = useMemo(
    () => createSourceCenteredNodePositions(nodes, links),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphSignature]
  );

  function readGraphCacheForCurrentGraph() {
    return readStoredGraphCache({ signature: graphSignature, nodes });
  }

  // 초기 렌더에서 graph cache를 한 번만 읽어 pan/zoom 초기값에 사용한다.
  const initialCacheRef = useRef<GraphCache | null | undefined>(undefined);
  if (initialCacheRef.current === undefined) {
    initialCacheRef.current = readGraphCacheForCurrentGraph();
  }
  const initialCache = initialCacheRef.current;

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<GraphSimulation | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const nodeHoverAmountsRef = useRef<Record<string, number>>({});
  const externalFocusedNodeIdRef = useRef<string | null>(focusedNodeId);
  const draggingNodeIdRef = useRef(draggingNodeId);
  const visibleNodeCountRef = useRef(visibleNodeCount);
  const graphZoomRef = useRef(initialCache?.zoom ?? 1);
  const graphPanRef = useRef<NodePosition>(initialCache?.pan ?? { x: 0, y: 0 });
  const isPointerHeldRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const cacheWriteRef = useRef<number | null>(null);
  const tickGraphRef = useRef<() => boolean>(() => false);
  const advanceHoverAnimationRef = useRef<(deltaMs: number) => boolean>(() => false);
  const requestAnimationRef = useRef<() => void>(() => {});
  const drawGraphRef = useRef<() => void>(() => {});
  const hitTestNodeRef = useRef<(clientX: number, clientY: number) => GraphNode | null>(() => null);
  const currentNodeBoundsRef = useRef<() => GraphRect | null>(() => null);
  const currentNodePositionsRef = useRef<() => NodePosition[]>(() => []);
  // 생성 중 노드 진행률은 매 프레임 바뀌므로 React 상태가 아니라 ref로 그리기에 전달한다.
  const ingestProgressRef = useGraphIngestProgress({ inputs: ingestProgressInputs, drawGraphRef });
  /** 현재 simulation이 쓰는 기준점(origin). 데이터 갱신 때 기존 노드에 그대로 넘겨 레이아웃이 다시 섞이지 않게 한다. */
  const originPositionsRef = useRef<NodePositionMap>({});
  /** 첫 렌더 뒤 추가된 노드의 등장 시작 시각(performance.now 기준). 등장이 끝나면 지운다. */
  const nodeEnterStartsRef = useRef<Record<string, number>>({});
  // 지금 등장 중인 묶음의 강조를 끌지(큰 묶음). 대기열이 빌 때 풀린다.
  const suppressEntryGlowRef = useRef(false);
  /** 새 노드가 모두 화면 밖일 때 카메라를 옮기는 중이면 그 시작·목표 pan */
  const revealPanRef = useRef<{ from: NodePosition; to: NodePosition; startTime: number } | null>(null);
  /** 사용자가 마지막으로 pan·zoom·노드 드래그한 시각. 최근에 움직였으면 카메라를 대신 옮기지 않는다. */
  const lastUserInteractionRef = useRef(Number.NEGATIVE_INFINITY);
  const { reduceMotion, preferencesReady } = useUserPreferences();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  function getSimNode(nodeId: string): GraphSimNode | null {
    return simulationRef.current?.nodeById.get(nodeId) ?? null;
  }

  function getNodePosition(nodeId: string): NodePosition {
    const revealPosition = reveal.displayPosition(nodeId);
    if (revealPosition) return revealPosition;
    const simNode = getSimNode(nodeId);
    if (simNode) return { x: simNode.x, y: simNode.y };
    return initialNodePositions[nodeId] ?? GRAPH_CENTER;
  }

  /** d3 ZoomTransform → 화면 pan 오프셋 (fit-scale 기준 좌표계) */
  function transformToPan(transform: ZoomTransform, canvas: HTMLCanvasElement): NodePosition {
    return {
      x: transform.x + ((transform.k - 1) * canvas.clientWidth) / 2,
      y: transform.y + ((transform.k - 1) * canvas.clientHeight) / 2
    };
  }

  function panToTransform(pan: NodePosition, zoomLevel: number, canvas: HTMLCanvasElement): ZoomTransform {
    return new ZoomTransform(
      zoomLevel,
      pan.x - ((zoomLevel - 1) * canvas.clientWidth) / 2,
      pan.y - ((zoomLevel - 1) * canvas.clientHeight) / 2
    );
  }

  // graph 데이터가 바뀌면 simulation을 새로 만든다.
  // 첫 표시는 캐시/초기 배치로 바로 그리고, 이미 그려진 그래프의 갱신(Lint·편입 완료 등)은
  // 기존 노드 위치·기준점을 이어받고 새 노드만 이웃 근처에서 서서히 나타나게 한다.
  useEffect(() => {
    const cached = readGraphCacheForCurrentGraph();
    const previousPositions = simulationRef.current ? simulationPositions(simulationRef.current) : {};
    simulationRef.current?.simulation.stop();
    // 남아 있는 노드가 하나도 없으면(첫 로드·워크스페이스 전환) 갱신이 아니라 첫 표시로 본다.
    const isUpdate = nodes.some((node) => previousPositions[node.id]);

    let addedPositions: NodePosition[] = [];
    if (isUpdate) {
      const { startPositions, originPositions, addedNodeIds } = planGraphUpdate({
        nodes,
        links,
        previousPositions,
        previousOrigins: originPositionsRef.current,
        layoutPositions: initialNodePositions
      });
      simulationRef.current = createGraphSimulation({
        nodes,
        links,
        startPositions,
        originPositions,
        initialAlpha: addedNodeIds.length > 0 ? GRAPH_UPDATE_ALPHA.nodesAdded : GRAPH_UPDATE_ALPHA.linksOnly,
        velocityDecay: GRAPH_UPDATE_VELOCITY_DECAY
      });
      originPositionsRef.current = originPositions;
      if (reveal.isActive()) {
        // 전체 연출 중에 들어온 노드는 따로 피어나지 않고 그 연출의 남은 순서에 합류한다.
        reveal.mergeAfterGraphChange();
      } else {
        // 동작 줄이기여도 시작 시각은 남긴다. 그때는 nodeEntryFrame이 고정 강조 링만 잠시 보여 준다.
        nodeEnterStartsRef.current = { ...nodeEnterStartsRef.current, ...scheduleNodeEntries(addedNodeIds, performance.now()) };
        suppressEntryGlowRef.current = shouldSuppressEntryGlow(
          Object.keys(nodeEnterStartsRef.current).length,
          suppressEntryGlowRef.current
        );
        addedPositions = addedNodeIds.map((nodeId) => startPositions[nodeId]);
      }
    } else {
      reveal.cancel();
      const startPositions = Object.fromEntries(
        nodes.map((node) => [node.id, cached?.positions[node.id] ?? initialNodePositions[node.id]])
      );
      simulationRef.current = createGraphSimulation({
        nodes,
        links,
        startPositions,
        originPositions: initialNodePositions
      });
      originPositionsRef.current = initialNodePositions;
      nodeEnterStartsRef.current = {};
      suppressEntryGlowRef.current = false;
    }

    // 갱신 때는 저장된 화면 대신 지금 보는 화면을 유지한다.
    const firstZoom = !isUpdate && !cached && canvasRef.current ? initialGraphZoom(canvasViewport(canvasRef.current)) : null;
    const nextZoom = clampGraphZoom((isUpdate ? null : cached?.zoom) ?? firstZoom ?? graphZoomRef.current);
    const nextPan = clampPan((isUpdate ? null : cached?.pan) ?? graphPanRef.current, nextZoom);
    applyViewState(nextPan, nextZoom);
    setVisibleNodeCount(nodes.length);
    // 곧이어 그리는 프레임이 이전 개수로 일부만 그리지 않게 ref도 바로 맞춘다.
    visibleNodeCountRef.current = nodes.length;
    if (isUpdate) {
      // 데이터 갱신으로 사용자가 고른·올려 둔 노드가 풀리지 않게, 아직 있는 노드면 그대로 둔다.
      const nodeIds = new Set(nodes.map((node) => node.id));
      const keepExisting = (nodeId: string | null) => (nodeId && nodeIds.has(nodeId) ? nodeId : null);
      selectedNodeIdRef.current = keepExisting(selectedNodeIdRef.current);
      hoveredNodeIdRef.current = keepExisting(hoveredNodeIdRef.current);
      startRevealPan(addedPositions);
    } else {
      const externalId = externalFocusedNodeIdRef.current;
      selectedNodeIdRef.current = externalId;
      hoveredNodeIdRef.current = externalId;
      nodeHoverAmountsRef.current = externalId ? { [externalId]: nodeHoverAmountsRef.current[externalId] ?? 1 } : {};
      revealPanRef.current = null;
    }
    drawGraphRef.current();
    requestAnimationRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature, initialNodePositions]);

  // 위 effect가 새 데이터로 simulation을 만든 뒤에 재생이 시작되도록 그 다음에 호출한다.
  const reveal = useGraphReveal({
    nodes,
    links,
    graphSignature,
    loading,
    preferencesReady,
    reduceMotion,
    revealRequest,
    simulationRef,
    draggingNodeIdRef,
    drawGraphRef,
    requestAnimationRef,
    onStart: () => {
      nodeEnterStartsRef.current = {};
      suppressEntryGlowRef.current = false;
      revealPanRef.current = null;
    }
  });

  /**
   * 새 노드가 모두 화면 밖이면 확대는 그대로 두고 그쪽으로 천천히 화면을 옮긴다.
   * 동작 줄이기이거나 사용자가 최근에 화면을 움직였으면 아무것도 하지 않는다.
   */
  function startRevealPan(positions: NodePosition[]) {
    const canvas = canvasRef.current;
    const now = performance.now();
    if (!canvas || reduceMotionRef.current) return;
    if (now - lastUserInteractionRef.current < GRAPH_ENTER_MOTION.revealIdleMs) return;
    const target = revealPan({ viewport: canvasViewport(canvas), pan: graphPanRef.current, zoom: graphZoomRef.current, positions });
    if (target) revealPanRef.current = { from: graphPanRef.current, to: target, startTime: now };
  }

  /** pan/zoom 상태와 d3-zoom 내부 transform을 함께 갱신한다. */
  function applyViewState(nextPan: NodePosition, nextZoom: number) {
    graphPanRef.current = nextPan;
    graphZoomRef.current = nextZoom;
    const canvas = canvasRef.current;
    const behavior = zoomBehaviorRef.current;
    if (canvas && behavior) {
      select(canvas).call(behavior.transform, panToTransform(nextPan, nextZoom, canvas));
    }
  }

  // raw 노드 아이콘 로드 완료 시 재드로우. 캐시 좌표로 곧바로 안정되는 경로에서도 폴백이 남지 않는다.
  useEffect(() => {
    preloadRawNodeIcon(() => drawGraphRef.current());
  }, []);

  // OS 색 모드나 고른 테마(html[data-theme])가 바뀌면 팔레트가 달라지므로 시뮬레이션이 멈춰 있어도 다시 그린다.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
    const redraw = () => drawGraphRef.current();
    mediaQuery.addEventListener("change", redraw);
    const themeObserver = new MutationObserver(redraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mediaQuery.removeEventListener("change", redraw);
      themeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    externalFocusedNodeIdRef.current = focusedNodeId;
  }, [focusedNodeId]);

  useEffect(() => {
    draggingNodeIdRef.current = draggingNodeId;
    if (draggingNodeId) lastUserInteractionRef.current = performance.now();
    requestAnimationRef.current();
  }, [draggingNodeId]);

  useEffect(() => {
    visibleNodeCountRef.current = visibleNodeCount;
    drawGraphRef.current();
  }, [visibleNodeCount]);

  // graphSignature를 ref로 유지해 안정 참조 콜백(d3-zoom, RAF)에서 최신 서명으로 캐시를 기록한다.
  const graphSignatureRef = useRef(graphSignature);
  useEffect(() => {
    graphSignatureRef.current = graphSignature;
  }, [graphSignature]);

  const scheduleGraphCacheWrite = useCallback(() => {
    if (typeof window === "undefined") return;
    if (cacheWriteRef.current !== null) window.clearTimeout(cacheWriteRef.current);

    cacheWriteRef.current = window.setTimeout(() => {
      if (simulationRef.current) {
        writeStoredGraphCache({
          signature: graphSignatureRef.current,
          positions: simulationPositions(simulationRef.current),
          pan: graphPanRef.current,
          zoom: graphZoomRef.current
        });
      }
      cacheWriteRef.current = null;
    }, GRAPH_CACHE_DEBOUNCE_MS);
  }, []);

  // d3-zoom: wheel 줌(포인터 중심) + 빈 영역 드래그 pan + 터치 핀치를 처리한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const behavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([GRAPH_ZOOM.min, GRAPH_ZOOM.max])
      .filter((event) => {
        if (event.type === "wheel") return true;
        if (event.type === "dblclick") return false; // 더블클릭은 노드 미리보기에 사용
        const button = typeof event.button === "number" ? event.button : 0;
        if (button !== 0 && button !== 1) return false;
        // 노드 위에서 시작한 제스처는 노드 드래그가 처리한다.
        return !hitTestNodeRef.current(event.clientX ?? 0, event.clientY ?? 0);
      })
      .constrain((transform) => {
        const canvasEl = canvasRef.current;
        if (!canvasEl) return transform;
        const pan = transformToPan(transform, canvasEl);
        const clamped = clampGraphPan({ viewport: canvasViewport(canvasEl), pan, zoom: transform.k, bounds: currentNodeBoundsRef.current() });
        if (clamped.x === pan.x && clamped.y === pan.y) return transform;
        return panToTransform(clamped, transform.k, canvasEl);
      })
      .on("zoom", (event) => {
        const canvasEl = canvasRef.current;
        if (!canvasEl) return;
        // 사용자가 직접 움직인 경우(sourceEvent가 있음)에는 진행 중인 자동 화면 이동을 멈춘다.
        if (event.sourceEvent) {
          lastUserInteractionRef.current = performance.now();
          revealPanRef.current = null;
        }
        const nextPan = transformToPan(event.transform, canvasEl);
        graphZoomRef.current = event.transform.k;
        graphPanRef.current = nextPan;
        drawGraphRef.current();
        scheduleGraphCacheWrite();
      });

    zoomBehaviorRef.current = behavior;
    const selection = select(canvas);
    selection.call(behavior);
    selection.call(behavior.transform, panToTransform(graphPanRef.current, graphZoomRef.current, canvas));

    let previousViewport = canvasViewport(canvas);
    const observer = new ResizeObserver(() => {
      const behaviorNow = zoomBehaviorRef.current;
      const canvasNow = canvasRef.current;
      if (!behaviorNow || !canvasNow) return;
      const viewport = canvasViewport(canvasNow);
      if (viewport.width <= 0 || viewport.height <= 0) return;
      // 사이드바·패널 펼침으로 캔버스가 바뀌면 노드는 두고 pan만 옮겨 노드가 다시 보이게 한다.
      // 노드 드래그 중에는 포인터 아래 노드가 튀지 않도록 기존 pan 제한만 적용한다.
      if (
        !draggingNodeIdRef.current &&
        (viewport.width !== previousViewport.width || viewport.height !== previousViewport.height)
      ) {
        graphPanRef.current = resizeGraphPan({
          previousViewport,
          viewport,
          pan: graphPanRef.current,
          zoom: graphZoomRef.current,
          positions: currentNodePositionsRef.current()
        });
      }
      previousViewport = viewport;
      // 리사이즈 후 constrain을 다시 적용해 pan 범위를 보정한다.
      select(canvasNow).call(
        behaviorNow.transform,
        panToTransform(graphPanRef.current, graphZoomRef.current, canvasNow)
      );
      drawGraphRef.current();
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      selection.on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (cacheWriteRef.current !== null) window.clearTimeout(cacheWriteRef.current);
  }, []);

  const setHoveredNode = useCallback((nodeId: string | null) => {
    if (hoveredNodeIdRef.current === nodeId) return;
    hoveredNodeIdRef.current = nodeId;
    drawGraphRef.current();
    requestAnimationRef.current();
  }, []);

  const setSelectedNode = useCallback((nodeId: string | null) => {
    if (selectedNodeIdRef.current === nodeId) return;
    selectedNodeIdRef.current = nodeId;
    hoveredNodeIdRef.current = nodeId;
    drawGraphRef.current();
    requestAnimationRef.current();
  }, []);

  // 같은 focusedNodeId로는 한 번만 선택을 적용한다. 데이터 refresh로 nodeById가
  // 새로 만들어져도 사용자가 캔버스에서 해제한 선택이 되살아나지 않게 한다.
  const appliedFocusedNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusedNodeId && nodeById.has(focusedNodeId)) {
      if (appliedFocusedNodeIdRef.current !== focusedNodeId) {
        appliedFocusedNodeIdRef.current = focusedNodeId;
        setSelectedNode(focusedNodeId);
      }
    } else if (!focusedNodeId) {
      appliedFocusedNodeIdRef.current = null;
      setSelectedNode(null);
    }
  }, [focusedNodeId, nodeById, setSelectedNode]);

  const stopDragging = useCallback((pointerId?: number) => {
    if (pointerId !== undefined && activePointerIdRef.current !== pointerId) return;
    isPointerHeldRef.current = false;
    activePointerIdRef.current = null;
    const draggedId = draggingNodeIdRef.current;
    if (draggedId) {
      const simNode = simulationRef.current?.nodeById.get(draggedId);
      if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
    }
    setDraggingNodeId(null);
    draggingNodeIdRef.current = null;
  }, []);

  useEffect(() => {
    const stopActiveDrag = (event?: PointerEvent) => stopDragging(event?.pointerId);
    const stopDragOnBlur = () => stopDragging();

    window.addEventListener("pointerup", stopActiveDrag);
    window.addEventListener("pointercancel", stopActiveDrag);
    window.addEventListener("blur", stopDragOnBlur);
    return () => {
      window.removeEventListener("pointerup", stopActiveDrag);
      window.removeEventListener("pointercancel", stopActiveDrag);
      window.removeEventListener("blur", stopDragOnBlur);
    };
  }, [stopDragging]);

  function graphToCanvas(position: NodePosition, canvas: HTMLCanvasElement) {
    return graphToCanvasPosition({ position, canvas, pan: graphPanRef.current, zoom: graphZoomRef.current });
  }

  function hitTestNode(clientX: number, clientY: number): GraphNode | null {
    const canvas = canvasRef.current;
    if (!canvas || reveal.isHoldingNodes()) return null;

    const rect = canvas.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    for (let index = visibleNodeCountRef.current - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (reveal.isNodeHidden(node.id)) continue;
      const screenPosition = graphToCanvas(getNodePosition(node.id), canvas);
      const radius = nodeSize(node) / 2;
      const distance = Math.hypot(pointerX - screenPosition.x, pointerY - screenPosition.y);
      if (distance <= radius + 2) return node;
    }

    return null;
  }

  function drawGraph() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const now = performance.now();
    // 등장 중인 노드의 모습은 프레임마다 한 번만 계산한다(링크마다 양 끝을 다시 계산하지 않는다).
    const entryFrames = entryFramesAt(nodeEnterStartsRef.current, now, reduceMotionRef.current, suppressEntryGlowRef.current);
    const revealFrames = reveal.framesAt(now);
    const isHolding = reveal.isHoldingNodes();

    drawGraphFrame({
      canvas,
      nodes: isHolding ? [] : nodes,
      links: isHolding ? [] : links,
      visibleNodeCount: visibleNodeCountRef.current,
      getNodePosition,
      nodeHoverAmounts: nodeHoverAmountsRef.current,
      graphToCanvas,
      nodeSize,
      isRawSourceLink,
      getNodeProgress: (nodeId) => ingestProgressRef.current.get(nodeId),
      getNodeEntry: (nodeId) => revealFrames?.get(nodeId) ?? entryFrames.get(nodeId) ?? null,
      getLinkOpacity: revealFrames ? (link) => reveal.linkOpacity(link, now) : undefined
    });
  }

  // render 중 ref 할당을 피하기 위해 매 렌더 후 layout effect에서 갱신한다.
  useLayoutEffect(() => {
    drawGraphRef.current = drawGraph;
    hitTestNodeRef.current = hitTestNode;
    currentNodeBoundsRef.current = currentNodeBounds;
    currentNodePositionsRef.current = currentNodePositions;
  });

  function advanceHoverAnimation(deltaMs: number) {
    const targetNodeId = hoveredNodeIdRef.current ?? selectedNodeIdRef.current;
    const amounts = nodeHoverAmountsRef.current;
    const smoothing = 1 - Math.exp(-deltaMs / HOVER_SMOOTHING_MS);
    let changed = false;

    Object.keys(amounts).forEach((nodeId) => {
      if (nodeById.has(nodeId)) return;
      delete amounts[nodeId];
      changed = true;
    });

    nodes.forEach((node) => {
      const target = node.id === targetNodeId ? 1 : 0;
      const current = amounts[node.id] ?? 0;
      const next = current + (target - current) * smoothing;
      const settled = Math.abs(next - target) <= HOVER_SETTLE_THRESHOLD ? target : next;

      if (Math.abs(settled - current) > HOVER_SETTLE_THRESHOLD) changed = true;
      if (settled <= HOVER_SETTLE_THRESHOLD && target === 0) {
        if (amounts[node.id] !== undefined) {
          delete amounts[node.id];
          changed = true;
        }
        return;
      }

      amounts[node.id] = settled;
    });

    return changed;
  }

  /** 등장 중인 노드가 있으면 true(다음 프레임도 그려야 함). 연출이 끝난 노드는 목록에서 뺀다. */
  function advanceNodeEnterAnimation() {
    const starts = nodeEnterStartsRef.current;
    const nodeIds = Object.keys(starts);
    if (nodeIds.length === 0) return false;
    const now = performance.now();
    nodeEnterStartsRef.current = Object.fromEntries(
      nodeIds
        .filter((nodeId) => nodeById.has(nodeId) && !nodeEntryFrame(starts[nodeId], now, reduceMotionRef.current).done)
        .map((nodeId) => [nodeId, starts[nodeId]])
    );
    suppressEntryGlowRef.current = shouldSuppressEntryGlow(
      Object.keys(nodeEnterStartsRef.current).length,
      suppressEntryGlowRef.current
    );
    return true;
  }

  /** 자동 화면 이동을 한 프레임 진행한다. 진행 중이면 true. */
  function advanceRevealPan() {
    const reveal = revealPanRef.current;
    if (!reveal) return false;
    const amount = Math.min(1, (performance.now() - reveal.startTime) / GRAPH_ENTER_MOTION.revealPanMs);
    const eased = easeInOutCubic(amount);
    if (amount >= 1) revealPanRef.current = null;
    applyViewState(
      { x: reveal.from.x + (reveal.to.x - reveal.from.x) * eased, y: reveal.from.y + (reveal.to.y - reveal.from.y) * eased },
      graphZoomRef.current
    );
    return true;
  }

  // hover·선택 전환과 함께 새 노드 등장·자동 화면 이동도 같은 RAF 루프에서 진행한다.
  advanceHoverAnimationRef.current = (deltaMs) => {
    const hoverChanged = advanceHoverAnimation(deltaMs);
    const entering = advanceNodeEnterAnimation();
    const panning = advanceRevealPan();
    const revealing = reveal.advance();
    return hoverChanged || entering || panning || revealing;
  };

  /** pan 제한 기준: 현재 노드들의 실제 분포(bbox). 고정 GRAPH_WIDTH 상자가 아니다. */
  function currentNodeBounds() {
    return graphNodeBounds(currentNodePositions());
  }

  function currentNodePositions() {
    return nodes.map((node) => getNodePosition(node.id));
  }

  function clampPan(nextPan: NodePosition, nextZoom = graphZoomRef.current) {
    const canvas = canvasRef.current;
    if (!canvas) return nextPan;
    return clampGraphPan({ viewport: canvasViewport(canvas), pan: nextPan, zoom: nextZoom, bounds: currentNodeBounds() });
  }

  /** 노드 드래그 위치 제한: 현재 화면에 보이는 캔버스 영역 안(노드 반지름만큼 안쪽). */
  function clampPosition(position: NodePosition, nodeId?: string) {
    const canvas = canvasRef.current;
    if (!canvas) return position;
    const node = nodeId ? nodeById.get(nodeId) : undefined;
    return clampGraphPosition({
      position,
      viewport: canvasViewport(canvas),
      pan: graphPanRef.current,
      zoom: graphZoomRef.current,
      nodeRadius: node ? nodeSize(node) / 2 : 0
    });
  }

  function tickGraph(): boolean {
    if (reveal.tick()) return true;
    const graphSimulation = simulationRef.current;
    if (!graphSimulation) return false;
    return tickGraphSimulation(graphSimulation, draggingNodeIdRef.current !== null);
  }

  tickGraphRef.current = tickGraph;

  useGraphAnimation({
    tickGraphRef,
    advanceHoverAnimationRef,
    drawGraphRef,
    draggingNodeIdRef,
    scheduleGraphCacheWrite,
    requestAnimationRef
  });

  const graphCanvasProps = useGraphPointer({
    nodes,
    links,
    draggingNodeIdRef,
    isPointerHeldRef,
    activePointerIdRef,
    externalFocusedNodeIdRef,
    drawGraphRef,
    hitTestNode,
    getSimNode,
    getSimulation: () => simulationRef.current,
    canvasToGraph: (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return canvasToGraphPosition({ clientX, clientY, canvas, pan: graphPanRef.current, zoom: graphZoomRef.current });
    },
    clampPosition,
    scheduleGraphCacheWrite,
    setDraggingNodeId,
    onOpenNodePreview,
    onClearNodeFocus,
    onNodeGrab: () => reveal.finish({ keepDisplayed: true }),
    setHoveredNode,
    setSelectedNode,
    stopDragging
  });

  return {
    canvasRef,
    graphCanvasProps
  };
}
