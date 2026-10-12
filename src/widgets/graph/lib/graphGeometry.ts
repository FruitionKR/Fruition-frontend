import type { NodePosition } from "@/entities/wiki";
import { GRAPH_CENTER, GRAPH_HEIGHT, GRAPH_WIDTH, GRAPH_ZOOM } from "@/entities/graph/lib/graph";

const GRAPH_VIEW_PADDING = 80;
/** pan 제한: 노드 분포(bbox)가 화면에 최소 이만큼(px)은 남아 있게 한다. */
export const GRAPH_PAN_MIN_VISIBLE = 80;
/** 리사이즈 맞춤: 노드 반지름·라벨이 잘리지 않도록 화면 가장자리에서 띄우는 여유(px).
 *  라벨은 노드 아래 가운데에 가로로 길게 붙으므로 가로는 긴 라벨의 절반, 세로는 노드 아래 라벨 높이만큼 둔다. */
export const GRAPH_RESIZE_PADDING = { x: 72, y: 36 } as const;

/** 캔버스 CSS 픽셀 크기 */
export type GraphViewport = { width: number; height: number };

/** 그래프 좌표계의 축 정렬 사각형 */
export type GraphRect = { minX: number; minY: number; maxX: number; maxY: number };

export function clampGraphZoom(nextZoom: number) {
  return Math.min(GRAPH_ZOOM.max, Math.max(GRAPH_ZOOM.min, nextZoom));
}

/** 드래그 노드로부터의 그래프 거리별 이동 영향도 (거리 4 이상은 0.03) */
const DISTANCE_INFLUENCE = [1, 0.34, 0.16, 0.07, 0.03] as const;

export function graphDistanceInfluence(distance: number | undefined) {
  if (distance === undefined) return 0;
  return DISTANCE_INFLUENCE[distance] ?? 0.03;
}

export function canvasViewport(canvas: HTMLCanvasElement): GraphViewport {
  return { width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height };
}

/** 그래프 좌표 1단위가 화면에서 차지하는 px (fit 배율 × zoom) */
export function viewportWorldScale(viewport: GraphViewport, zoom: number) {
  const fitWidth = Math.max(1, viewport.width - GRAPH_VIEW_PADDING * 2) / GRAPH_WIDTH;
  const fitHeight = Math.max(1, viewport.height - GRAPH_VIEW_PADDING * 2) / GRAPH_HEIGHT;
  return Math.max(0.1, Math.min(fitWidth, fitHeight, 1)) * zoom;
}

export function canvasWorldScale(canvas: HTMLCanvasElement, zoom: number) {
  return viewportWorldScale(canvasViewport(canvas), zoom);
}

/** 노드 위치들의 경계 사각형. 노드가 없으면 null. */
export function graphNodeBounds(positions: Iterable<NodePosition>): GraphRect | null {
  let bounds: GraphRect | null = null;
  for (const { x, y } of positions) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    bounds = bounds
      ? { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return bounds;
}

/**
 * pan 제한: 노드 bbox가 화면 밖으로 완전히 사라지지 않게 한다.
 * bbox의 화면 투영이 각 축에서 최소 GRAPH_PAN_MIN_VISIBLE px(화면이 좁으면 절반)만큼 화면과 겹치도록 clamp한다.
 * 노드가 없으면(bounds null) 제한하지 않는다.
 */
export function clampGraphPan({
  viewport,
  pan,
  zoom,
  bounds
}: {
  viewport: GraphViewport;
  pan: NodePosition;
  zoom: number;
  bounds: GraphRect | null;
}) {
  if (!bounds) return pan;
  const scale = viewportWorldScale(viewport, zoom);
  return {
    x: clampPanAxis(pan.x, viewport.width, (bounds.minX - GRAPH_CENTER.x) * scale, (bounds.maxX - GRAPH_CENTER.x) * scale),
    y: clampPanAxis(pan.y, viewport.height, (bounds.minY - GRAPH_CENTER.y) * scale, (bounds.maxY - GRAPH_CENTER.y) * scale)
  };
}

/**
 * 캔버스 크기가 바뀔 때(사이드바·채팅 패널 펼침 등) 노드는 그대로 두고 pan만 다시 계산한다.
 * 기준은 리사이즈 전 화면 중심이 가리키던 그래프 좌표를 새 화면 중심에 두는 pan이고, 축마다
 * 1) 전체 노드 bbox(+패딩)가 들어가면 전부 보이도록, 2) 아니면 리사이즈 전에 보이던 노드들이
 * 들어가면 그것들이 보이도록 최소 이동한다. 마지막으로 clampGraphPan을 적용한다.
 */
export function resizeGraphPan({
  previousViewport,
  viewport,
  pan,
  zoom,
  positions
}: {
  previousViewport: GraphViewport;
  viewport: GraphViewport;
  pan: NodePosition;
  zoom: number;
  positions: readonly NodePosition[];
}) {
  const scale = viewportWorldScale(viewport, zoom);
  // fit 배율이 화면 크기에 따라 바뀌므로 비율을 곱해야 화면 중심의 그래프 좌표가 유지된다.
  const ratio = scale / viewportWorldScale(previousViewport, zoom);
  const centered = { x: pan.x * ratio, y: pan.y * ratio };
  const bounds = graphNodeBounds(positions);
  if (!bounds) return centered;

  const previousRect = graphViewportRect({ viewport: previousViewport, pan, zoom });
  const visibleBounds = graphNodeBounds(
    positions.filter(
      ({ x, y }) => x >= previousRect.minX && x <= previousRect.maxX && y >= previousRect.minY && y <= previousRect.maxY
    )
  );
  const candidates = visibleBounds ? [bounds, visibleBounds] : [bounds];
  const fitAxis = (value: number, size: number, axis: "x" | "y") => {
    for (const rect of candidates) {
      const min = axis === "x" ? rect.minX : rect.minY;
      const max = axis === "x" ? rect.maxX : rect.maxY;
      const fitted = fitPanAxis(value, size, GRAPH_RESIZE_PADDING[axis], (min - GRAPH_CENTER[axis]) * scale, (max - GRAPH_CENTER[axis]) * scale);
      if (fitted !== null) return fitted;
    }
    return value;
  };
  return clampGraphPan({
    viewport,
    pan: { x: fitAxis(centered.x, viewport.width, "x"), y: fitAxis(centered.y, viewport.height, "y") },
    zoom,
    bounds
  });
}

/** 현재 화면(줌·팬 반영)에 보이는 영역을 그래프 좌표로 변환한다. */
export function graphViewportRect({
  viewport,
  pan,
  zoom
}: {
  viewport: GraphViewport;
  pan: NodePosition;
  zoom: number;
}): GraphRect {
  const scale = viewportWorldScale(viewport, zoom);
  return {
    minX: GRAPH_CENTER.x + (-viewport.width / 2 - pan.x) / scale,
    minY: GRAPH_CENTER.y + (-viewport.height / 2 - pan.y) / scale,
    maxX: GRAPH_CENTER.x + (viewport.width / 2 - pan.x) / scale,
    maxY: GRAPH_CENTER.y + (viewport.height / 2 - pan.y) / scale
  };
}

export function graphToCanvasPosition({
  position,
  canvas,
  pan,
  zoom
}: {
  position: NodePosition;
  canvas: HTMLCanvasElement;
  pan: NodePosition;
  zoom: number;
}) {
  const scale = canvasWorldScale(canvas, zoom);
  return {
    x: canvas.clientWidth / 2 + pan.x + (position.x - GRAPH_CENTER.x) * scale,
    y: canvas.clientHeight / 2 + pan.y + (position.y - GRAPH_CENTER.y) * scale
  };
}

export function canvasToGraphPosition({
  clientX,
  clientY,
  canvas,
  pan,
  zoom
}: {
  clientX: number;
  clientY: number;
  canvas: HTMLCanvasElement;
  pan: NodePosition;
  zoom: number;
}) {
  const rect = canvas.getBoundingClientRect();
  const scale = canvasWorldScale(canvas, zoom);
  return {
    x: GRAPH_CENTER.x + (clientX - rect.left - canvas.clientWidth / 2 - pan.x) / scale,
    y: GRAPH_CENTER.y + (clientY - rect.top - canvas.clientHeight / 2 - pan.y) / scale
  };
}

/**
 * 노드 드래그 위치 제한: 현재 화면에 보이는 영역 안, 가장자리에서 노드 반지름(px)만큼 안쪽.
 * 화면이 노드보다 좁으면 해당 축은 화면 중앙에 둔다.
 */
export function clampGraphPosition({
  position,
  viewport,
  pan,
  zoom,
  nodeRadius
}: {
  position: NodePosition;
  viewport: GraphViewport;
  pan: NodePosition;
  zoom: number;
  nodeRadius: number;
}) {
  const rect = graphViewportRect({ viewport, pan, zoom });
  const margin = nodeRadius / viewportWorldScale(viewport, zoom);
  return {
    x: clampAxis(position.x, rect.minX + margin, rect.maxX - margin),
    y: clampAxis(position.y, rect.minY + margin, rect.maxY - margin)
  };
}

function clampAxis(value: number, min: number, max: number) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/** 한 축에서 [minOffset, maxOffset](+패딩)이 화면 안에 들어가는 가장 가까운 pan. 들어갈 수 없으면 null. */
function fitPanAxis(pan: number, viewportSize: number, padding: number, minOffset: number, maxOffset: number) {
  const minPan = padding - viewportSize / 2 - minOffset;
  const maxPan = viewportSize / 2 - padding - maxOffset;
  if (minPan > maxPan) return null;
  return Math.min(maxPan, Math.max(minPan, pan));
}

/**
 * 한 축의 pan 범위. 화면 좌표 = size/2 + pan + offset 이므로
 * bbox 오른쪽 끝 ≥ visible, 왼쪽 끝 ≤ size - visible 이 되도록 pan을 제한한다.
 */
function clampPanAxis(pan: number, viewportSize: number, minOffset: number, maxOffset: number) {
  const visible = Math.min(GRAPH_PAN_MIN_VISIBLE, viewportSize / 2);
  const minPan = visible - viewportSize / 2 - maxOffset;
  const maxPan = viewportSize / 2 - visible - minOffset;
  return Math.min(maxPan, Math.max(minPan, pan));
}
