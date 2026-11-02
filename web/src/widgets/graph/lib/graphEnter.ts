import type { GraphLink, GraphNode, NodePosition, NodePositionMap } from "@/entities/wiki";
import { GRAPH_CENTER } from "@/entities/graph/lib/graphBuilder";
import { viewportWorldScale, type GraphViewport } from "./graphGeometry";

/**
 * 첫 렌더 뒤에 추가된 노드의 등장 연출 값.
 * 순서: 이웃에서 링크가 뻗어 나옴(edgeDrawMs) → 그 끝에서 노드가 피어남(bloomMs, 살짝 넘침)
 * → 라벨이 뒤따라 나타남 → 새 노드 강조가 glowMs에 걸쳐 사라짐.
 */
export const GRAPH_ENTER_MOTION = {
  edgeDrawMs: 250,
  bloomMs: 550,
  labelDelayMs: 200,
  labelFadeMs: 250,
  glowMs: 1800,
  /** 동작 줄이기: 애니메이션 없이 고정 강조 링만 이만큼 보인다. */
  reducedHighlightMs: 2000,
  /** 여러 노드가 함께 들어올 때 노드 사이 시작 간격 */
  staggerMs: 75,
  /** 큰 묶음도 마지막 노드가 이 시간 안에 시작하도록 간격을 줄인다(마지막 노드는 ≈ 이 값 + edge + bloom에 다 핀다). */
  maxStaggerTotalMs: 1100,
  /** 등장 시작 크기 비율 */
  startScale: 0.4,
  /** easeOutBack 넘침 정도. 1.70158이 표준값이고, 차분하게 보이도록 낮췄다. */
  bloomOvershoot: 1.2,
  /**
   * 이웃 중심에서 떨어뜨려 놓는 거리(그래프 좌표). collide 반경 합(source 44 + raw 16 등)에 가깝게 둬
   * 겹친 채 태어나 이웃을 밀어내며 튕기지 않게 한다.
   */
  spawnOffset: 56,
  /** 새 노드가 모두 화면 밖일 때 카메라를 옮기는 시간과, 노드를 둘 화면 가장자리 여백 비율 */
  revealPanMs: 600,
  revealMargin: 0.2,
  /** 사용자가 이 시간 안에 화면을 움직였으면 카메라를 옮기지 않는다. */
  revealIdleMs: 10_000
};

/** 데이터 갱신 뒤 simulation을 다시 데우는 alpha. 새로 만들 때 기본값 1보다 훨씬 낮게 둔다. */
export const GRAPH_UPDATE_ALPHA = {
  nodesAdded: 0.25,
  linksOnly: 0.1
};

/** 갱신 뒤 settle 동안의 속도 감쇠(d3 기본 0.4). 높여서 기존 노드가 휘청이지 않게 한다. */
export const GRAPH_UPDATE_VELOCITY_DECAY = 0.55;

/** 한 프레임에서 새 노드를 그리는 데 필요한 값. edge·opacity·label·glow는 0~1이다. */
export type NodeEntryFrame = {
  /** 이웃에서 이 노드로 뻗는 링크의 진행도 */
  edge: number;
  opacity: number;
  scale: number;
  label: number;
  /** 새 노드 강조(링·광채) 세기 */
  glow: number;
  /** true면 강조를 움직임 없는 링으로만 그린다(동작 줄이기). */
  staticRing: boolean;
  /** 연출이 모두 끝났으면 true */
  done: boolean;
};

/**
 * 그래프 데이터 갱신 시 기존 노드는 지금 위치·기준점을 그대로 이어받고,
 * 새 노드는 이미 자리 잡은 이웃(들)의 중심 근처에서 시작하게 한다.
 * 이웃이 모두 새 노드면 앞에서 자리 잡은 새 이웃을 기준으로 삼고, 끝내 이웃이 없으면 layoutPositions를 쓴다.
 * addedNodeIds는 자리 잡은 순서(기존 노드에 가까운 것부터)다. 등장 순서로 그대로 쓴다.
 */
export function planGraphUpdate({
  nodes,
  links,
  previousPositions,
  previousOrigins,
  layoutPositions
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  previousPositions: NodePositionMap;
  previousOrigins: NodePositionMap;
  layoutPositions: NodePositionMap;
}): { startPositions: NodePositionMap; originPositions: NodePositionMap; addedNodeIds: string[] } {
  const startPositions: NodePositionMap = {};
  const originPositions: NodePositionMap = {};
  const newNodeIds: string[] = [];
  const addedNodeIds: string[] = [];

  nodes.forEach((node) => {
    const previous = previousPositions[node.id];
    if (previous) {
      startPositions[node.id] = previous;
      originPositions[node.id] = previousOrigins[node.id] ?? previous;
    } else {
      newNodeIds.push(node.id);
    }
  });

  const neighbors = neighborMap(links);
  let pending = newNodeIds;
  while (pending.length > 0) {
    // 한 단계에서는 이전 단계까지 자리 잡은 노드만 기준으로 삼아, 순서가 거리(단계)를 따르게 한다.
    const placedBefore = { ...startPositions };
    const unplaced = pending.filter((nodeId) => {
      const placedNeighbors = (neighbors.get(nodeId) ?? []).filter((neighborId) => placedBefore[neighborId]);
      if (placedNeighbors.length === 0) return true;
      const position = spawnNearNeighbors(nodeId, placedNeighbors.map((neighborId) => placedBefore[neighborId]));
      startPositions[nodeId] = position;
      originPositions[nodeId] = position;
      addedNodeIds.push(nodeId);
      return false;
    });
    if (unplaced.length === pending.length) break;
    pending = unplaced;
  }
  pending.forEach((nodeId) => {
    const position = layoutPositions[nodeId] ?? { x: 0, y: 0 };
    startPositions[nodeId] = position;
    originPositions[nodeId] = position;
    addedNodeIds.push(nodeId);
  });

  return { startPositions, originPositions, addedNodeIds };
}

/** 이웃 위치 중심에서 id마다 정해진 방향으로 spawnOffset만큼 떨어진 좌표. 같은 입력이면 항상 같은 값이다. */
export function spawnNearNeighbors(nodeId: string, neighborPositions: { x: number; y: number }[]) {
  const center = neighborPositions.reduce(
    (sum, position) => ({ x: sum.x + position.x / neighborPositions.length, y: sum.y + position.y / neighborPositions.length }),
    { x: 0, y: 0 }
  );
  const angle = (stableHash(nodeId) % 360) * (Math.PI / 180);
  return {
    x: center.x + Math.cos(angle) * GRAPH_ENTER_MOTION.spawnOffset,
    y: center.y + Math.sin(angle) * GRAPH_ENTER_MOTION.spawnOffset
  };
}

/** 새 노드마다 등장 시작 시각을 정한다. 간격은 staggerMs이되 전체가 maxStaggerTotalMs를 넘지 않는다. */
export function scheduleNodeEntries(nodeIds: string[], now: number): Record<string, number> {
  const { staggerMs, maxStaggerTotalMs } = GRAPH_ENTER_MOTION;
  const step = nodeIds.length > 1 ? Math.min(staggerMs, maxStaggerTotalMs / (nodeIds.length - 1)) : 0;
  return Object.fromEntries(nodeIds.map((nodeId, index) => [nodeId, now + index * step]));
}

/**
 * 한 번에 이보다 많은 노드가 등장 중이면 광채·링 강조를 그리지 않는다(피어나는 연출은 그대로).
 * 큰 묶음에서는 강조가 화면을 덮을 뿐 아니라 노드마다 그라데이션을 칠하는 비용이 프레임을 잡아먹는다.
 */
export const NEW_NODE_GLOW_LIMIT = 40;

/** 등장 대기열 크기로 강조를 끌지 정한다. 이미 끈 묶음은 대기열이 비기 전까지 끈 채로 둔다(중간에 강조가 켜지며 튀지 않게). */
export function shouldSuppressEntryGlow(enteringCount: number, alreadySuppressed: boolean) {
  if (enteringCount === 0) return false;
  return alreadySuppressed || enteringCount > NEW_NODE_GLOW_LIMIT;
}

/** 이번 프레임에 등장 중인 노드들의 모습을 한 번에 계산한다. 그리기는 노드·링크마다 이 Map만 찾아 본다. */
export function entryFramesAt(
  starts: Readonly<Record<string, number>>,
  now: number,
  reduceMotion: boolean,
  suppressGlow: boolean
): Map<string, NodeEntryFrame> {
  const frames = new Map<string, NodeEntryFrame>();
  for (const nodeId in starts) {
    const frame = nodeEntryFrame(starts[nodeId], now, reduceMotion);
    frames.set(nodeId, suppressGlow ? { ...frame, glow: 0 } : frame);
  }
  return frames;
}

/** 시작 시각과 현재 시각으로 새 노드의 이번 프레임 모습을 계산한다. */
export function nodeEntryFrame(startTime: number, now: number, reduceMotion: boolean): NodeEntryFrame {
  const motion = GRAPH_ENTER_MOTION;
  const elapsed = now - startTime;
  if (reduceMotion) {
    const highlighted = elapsed < motion.reducedHighlightMs;
    return { edge: 1, opacity: 1, scale: 1, label: 1, glow: highlighted ? 1 : 0, staticRing: true, done: !highlighted };
  }

  const edge = easeOutCubic(progress(elapsed, 0, motion.edgeDrawMs));
  const bloom = progress(elapsed, motion.edgeDrawMs, motion.bloomMs);
  const label = easeOutCubic(progress(elapsed, motion.edgeDrawMs + motion.labelDelayMs, motion.labelFadeMs));
  const glowProgress = progress(elapsed, motion.edgeDrawMs, motion.glowMs);
  return {
    edge,
    opacity: easeOutCubic(bloom),
    scale: bloom >= 1 ? 1 : motion.startScale + (1 - motion.startScale) * easeOutBack(bloom, motion.bloomOvershoot),
    label,
    // 노드가 피어나는 동안 올라왔다가 남은 시간 동안 천천히 사라진다.
    glow: glowProgress >= 1 ? 0 : Math.min(1, glowProgress * 4) * (1 - easeOutCubic(glowProgress)),
    staticRing: false,
    done: elapsed >= motion.edgeDrawMs + motion.glowMs
  };
}

/**
 * 새 노드가 모두 화면 밖이면 그 중심이 화면 가장자리 여백(revealMargin) 안에 들어오도록 옮긴 pan을 돌려준다.
 * 확대는 바꾸지 않는다. 하나라도 보이거나 노드가 없으면 null이다.
 */
export function revealPan({
  viewport,
  pan,
  zoom,
  positions
}: {
  viewport: GraphViewport;
  pan: NodePosition;
  zoom: number;
  positions: NodePosition[];
}): NodePosition | null {
  if (positions.length === 0) return null;
  const scale = viewportWorldScale(viewport, zoom);
  const toScreen = (position: NodePosition) => ({
    x: viewport.width / 2 + pan.x + (position.x - GRAPH_CENTER.x) * scale,
    y: viewport.height / 2 + pan.y + (position.y - GRAPH_CENTER.y) * scale
  });
  const screens = positions.map(toScreen);
  const isVisible = ({ x, y }: NodePosition) => x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height;
  if (screens.some(isVisible)) return null;

  const center = {
    x: screens.reduce((sum, screen) => sum + screen.x, 0) / screens.length,
    y: screens.reduce((sum, screen) => sum + screen.y, 0) / screens.length
  };
  const marginX = viewport.width * GRAPH_ENTER_MOTION.revealMargin;
  const marginY = viewport.height * GRAPH_ENTER_MOTION.revealMargin;
  const targetX = Math.min(viewport.width - marginX, Math.max(marginX, center.x));
  const targetY = Math.min(viewport.height - marginY, Math.max(marginY, center.y));
  return { x: pan.x + targetX - center.x, y: pan.y + targetY - center.y };
}

export function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

function progress(elapsed: number, delay: number, duration: number) {
  return Math.min(1, Math.max(0, (elapsed - delay) / duration));
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

function easeOutBack(value: number, overshoot: number) {
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function neighborMap(links: GraphLink[]) {
  const neighbors = new Map<string, string[]>();
  const add = (nodeId: string, neighborId: string) => {
    const list = neighbors.get(nodeId);
    if (list) list.push(neighborId);
    else neighbors.set(nodeId, [neighborId]);
  };
  links.forEach((link) => {
    add(link.from, link.to);
    add(link.to, link.from);
  });
  return neighbors;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
