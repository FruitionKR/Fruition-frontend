import type { GraphLink, GraphNode, NodePositionMap } from "@/entities/wiki";

/** 첫 렌더 뒤에 추가된 노드의 등장 연출 값 */
export const GRAPH_ENTER_MOTION = {
  durationMs: 420,
  /** 여러 노드가 함께 들어올 때 노드 사이 시작 간격 */
  staggerMs: 60,
  /** 큰 묶음도 마지막 노드가 이 시간 안에 시작하도록 간격을 줄인다(총 ≈ 이 값 + durationMs). */
  maxStaggerTotalMs: 1080,
  /** 등장 시작 크기 비율 */
  startScale: 0.4,
  /**
   * 이웃 중심에서 떨어뜨려 놓는 거리(그래프 좌표). collide 반경 합(source 44 + raw 16 등)에 가깝게 둬
   * 겹친 채 태어나 이웃을 밀어내며 튕기지 않게 한다.
   */
  spawnOffset: 56
};

/** 데이터 갱신 뒤 simulation을 다시 데우는 alpha. 새로 만들 때 기본값 1보다 훨씬 낮게 둔다. */
export const GRAPH_UPDATE_ALPHA = {
  nodesAdded: 0.25,
  linksOnly: 0.1
};

/**
 * 그래프 데이터 갱신 시 기존 노드는 지금 위치·기준점을 그대로 이어받고,
 * 새 노드는 이미 자리 잡은 이웃(들)의 중심 근처에서 시작하게 한다.
 * 이웃이 모두 새 노드면 앞에서 자리 잡은 새 이웃을 기준으로 삼고, 끝내 이웃이 없으면 layoutPositions를 쓴다.
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
  const addedNodeIds: string[] = [];

  nodes.forEach((node) => {
    const previous = previousPositions[node.id];
    if (previous) {
      startPositions[node.id] = previous;
      originPositions[node.id] = previousOrigins[node.id] ?? previous;
    } else {
      addedNodeIds.push(node.id);
    }
  });

  const neighbors = neighborMap(links);
  let pending = addedNodeIds;
  while (pending.length > 0) {
    const unplaced = pending.filter((nodeId) => {
      const placedNeighbors = (neighbors.get(nodeId) ?? []).filter((neighborId) => startPositions[neighborId]);
      if (placedNeighbors.length === 0) return true;
      const position = spawnNearNeighbors(nodeId, placedNeighbors.map((neighborId) => startPositions[neighborId]));
      startPositions[nodeId] = position;
      originPositions[nodeId] = position;
      return false;
    });
    if (unplaced.length === pending.length) break;
    pending = unplaced;
  }
  pending.forEach((nodeId) => {
    const position = layoutPositions[nodeId] ?? { x: 0, y: 0 };
    startPositions[nodeId] = position;
    originPositions[nodeId] = position;
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

/** 등장 진행도(0~1, ease-out cubic). 시작 전이면 0이다. */
export function nodeEnterAmount(startTime: number | undefined, now: number) {
  if (startTime === undefined) return 1;
  const linear = Math.min(1, Math.max(0, (now - startTime) / GRAPH_ENTER_MOTION.durationMs));
  return 1 - (1 - linear) ** 3;
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
