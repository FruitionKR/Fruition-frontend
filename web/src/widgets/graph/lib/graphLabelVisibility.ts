import { GRAPH_ZOOM } from "@/entities/graph/lib/graphBuilder";
import { viewportWorldScale, type GraphViewport } from "./graphGeometry";

export type LabelBox = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  priority: number;
  /** 누른 노드의 라벨처럼 다른 노드와 겹쳐도 남길 라벨 */
  isPinned?: boolean;
};
export type NodeDisc = { id: string; x: number; y: number; radius: number };

/** 그래프 화면의 짧은 변이 이보다 작으면 라벨을 골라 그리고 첫 배율을 키운다. 태블릿·데스크톱은 그대로 둔다. */
const SMALL_VIEWPORT_MAX_SHORT_SIDE = 480;
/** 작은 화면의 첫 화면에서 그래프 좌표 1단위가 차지할 px. 덩어리가 화면을 넘지 않을 만큼만 키운다. */
const SMALL_VIEWPORT_WORLD_SCALE = 0.36;
const LABEL_GAP = 2;

export function isSmallGraphViewport(viewport: GraphViewport): boolean {
  return Math.min(viewport.width, viewport.height) < SMALL_VIEWPORT_MAX_SHORT_SIDE;
}

/** 저장된 화면이 없을 때의 첫 배율. 작은 화면은 맞춤 배율이 작아 노드가 한 덩어리로 모이므로 키운다. */
export function initialGraphZoom(viewport: GraphViewport): number {
  if (!isSmallGraphViewport(viewport)) return 1;
  const zoom = SMALL_VIEWPORT_WORLD_SCALE / viewportWorldScale(viewport, 1);
  return Math.max(1, Math.min(GRAPH_ZOOM.max, zoom));
}

function overlaps(a: LabelBox, b: LabelBox) {
  return a.left < b.right + LABEL_GAP && b.left < a.right + LABEL_GAP && a.top < b.bottom + LABEL_GAP && b.top < a.bottom + LABEL_GAP;
}

function coversNode(label: LabelBox, node: NodeDisc) {
  if (node.id === label.id) return false;
  const nearestX = Math.max(label.left, Math.min(node.x, label.right));
  const nearestY = Math.max(label.top, Math.min(node.y, label.bottom));
  return (nearestX - node.x) ** 2 + (nearestY - node.y) ** 2 < node.radius ** 2;
}

/**
 * 우선순위가 높은 라벨부터 놓으며 앞서 놓은 라벨과 겹치거나 다른 노드 위에 얹히면 뺀다. 같은 우선순위는 입력 순서를 따른다.
 * 노드 위에 얹힌 라벨은 글자와 노드가 겹쳐 읽히지 않고, 뺀 라벨은 다른 라벨의 자리를 막지 않는다.
 */
export function pickVisibleLabels(labels: readonly LabelBox[], nodes: readonly NodeDisc[] = []): Set<string> {
  const placed: LabelBox[] = [];
  for (const label of [...labels].sort((a, b) => b.priority - a.priority)) {
    if (!label.isPinned && nodes.some((node) => coversNode(label, node))) continue;
    if (!placed.some((other) => overlaps(label, other))) placed.push(label);
  }
  return new Set(placed.map((label) => label.id));
}
