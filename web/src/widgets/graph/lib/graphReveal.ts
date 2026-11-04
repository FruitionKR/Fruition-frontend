import type { GraphLink, GraphNode, NodePosition } from "@/entities/wiki";
import { GRAPH_ENTER_MOTION, easeInOutCubic, easeOutBack, easeOutCubic, type NodeEntryFrame } from "./graphEnter";

/**
 * 그래프 전체가 노드 하나씩 완성되는 연출(새로고침 버튼·페이지 첫 표시) 값.
 * 순서: 노드가 작게 나타나 커짐(nodeAppearMs) → 양쪽 노드가 다 나타난 링크가 서서히 보임(linkFadeMs).
 *
 * 나온 노드의 움직임은 연출 전용 simulation이 맡고, 본 simulation은 연출 동안 멈춰 둔다. 화면 좌표는 연출 좌표에서
 * 본 좌표로 옮겨 가 endTime에 정확히 본 좌표가 되므로, 끝난 뒤의 배치와 동작은 연출이 없을 때와 같다.
 */
export const GRAPH_REVEAL_MOTION = {
  /** 노드가 어느 정도 있으면 이 시간 이상 걸린다. */
  minTotalMs: 2000,
  /** 노드 수와 상관없이 이 시간 안에 끝난다. */
  maxTotalMs: 2800,
  /** 노드가 10배 늘 때마다 늘어나는 시간 */
  msPerTenfoldNodes: 300,
  nodeAppearMs: 260,
  linkFadeMs: 180,
  /** 마지막 노드가 나온 뒤 끝날 때까지의 시간. 나오자마자 제자리로 끌려가지 않도록 나타남·링크 시간보다 길게 둔다. */
  settleTailMs: 640,
  /** 노드가 적을 때 하나하나의 시작 간격 상한. 몇 개 안 되는 그래프가 늘어지지 않게 한다. */
  maxStepMs: 180,
  /** 묶음 사이 최소 간격. 물리 tick(32ms)보다 자주 simulation 대상을 바꿀 이유가 없다. */
  minBatchIntervalMs: 32,
  /** 연출 중 데이터가 바뀌었을 때 남은 노드가 합류할 최소 시간 */
  minMergeWindowMs: 400,
  /** 등장 시작 크기 비율 */
  startScale: 0.2,
  /** 연출 simulation의 alpha. 나온 노드가 힘을 받아 자리를 찾아갈 만큼 데운 채 유지한다. */
  simAlpha: 0.6,
  /** 연출 simulation에서 본 좌표로 끄는 힘. 평소 기준점 힘(0.045)보다 세게 둬 끝에서 크게 끌려오지 않게 한다. */
  simTargetStrength: 0.2,
  /** 연결 노드에서 이만큼 떨어져 나온다(그래프 좌표). collide 반경 합에 가까워 겹친 채 튕기지 않는다. */
  spawnOffset: GRAPH_ENTER_MOTION.spawnOffset
};

export type GraphRevealEntry = {
  nodeId: string;
  /** 이 노드가 나올 자리의 기준이 되는, 먼저 나타난 연결 노드. 무리의 첫 노드는 null이다. */
  anchorId: string | null;
  atMs: number;
};

export type GraphRevealPlan = { entries: GraphRevealEntry[]; durationMs: number };

export type GraphRevealState = {
  /** at(절대 시각) 오름차순 */
  entries: { nodeId: string; anchorId: string | null; at: number }[];
  /** entries에서 아직 내놓지 않은 첫 위치 */
  nextIndex: number;
  startsById: Map<string, number>;
  endTime: number;
};

const REVEAL_TAIL_MS = Math.max(GRAPH_REVEAL_MOTION.settleTailMs, GRAPH_REVEAL_MOTION.nodeAppearMs + GRAPH_REVEAL_MOTION.linkFadeMs);

const HIDDEN_FRAME: NodeEntryFrame = { edge: 0, opacity: 0, scale: 0, label: 0, glow: 0, staticRing: false, done: false };

/** 노드 수로 전체 시간을 정한다. 노드 수의 로그에 비례하고 상한을 넘지 않으며, 몇 개 안 되면 간격 상한만큼만 걸린다. */
export function revealDurationMs(nodeCount: number) {
  if (nodeCount <= 0) return 0;
  const { minTotalMs, maxTotalMs, msPerTenfoldNodes, maxStepMs } = GRAPH_REVEAL_MOTION;
  const scaled = minTotalMs + msPerTenfoldNodes * Math.log10(Math.max(nodeCount, 10) / 10);
  const total = Math.min(maxTotalMs, scaled);
  return Math.min(total, (nodeCount - 1) * maxStepMs + REVEAL_TAIL_MS);
}

/** count개 노드의 시작 시각(0~windowMs). 간격이 minBatchIntervalMs보다 좁아지면 같은 시각의 묶음으로 나눈다. */
function scheduleStarts(count: number, windowMs: number) {
  const batchCount = Math.min(count, Math.floor(windowMs / GRAPH_REVEAL_MOTION.minBatchIntervalMs) + 1);
  if (batchCount <= 1) return new Array<number>(count).fill(0);
  return Array.from({ length: count }, (_, index) =>
    (Math.floor((index * batchCount) / count) * windowMs) / (batchCount - 1)
  );
}

function adjacencyOf(nodes: GraphNode[], links: GraphLink[]) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  links.forEach((link) => {
    if (link.from === link.to) return;
    const from = adjacency.get(link.from);
    const to = adjacency.get(link.to);
    if (!from || !to) return;
    from.add(link.to);
    to.add(link.from);
  });
  return adjacency;
}

/**
 * 등장 순서: 무리(연결 요소)를 큰 것부터, 무리 안에서는 연결이 가장 많은 노드에서 BFS한다.
 * 그래서 먼저 나온 노드에 이어 붙듯 그래프가 자라고, 고아 노드는 맨 뒤에 나온다.
 * 동점은 원본 문서 쪽(source)을 앞에 두고 id로 정해, 입력 순서가 달라도 같은 순서가 된다.
 */
function revealOrder(nodes: GraphNode[], links: GraphLink[]) {
  const adjacency = adjacencyOf(nodes, links);
  const kindById = new Map(nodes.map((node) => [node.id, node.kind]));
  const degree = (nodeId: string) => adjacency.get(nodeId)?.size ?? 0;
  const byPriority = (first: string, second: string) =>
    degree(second) - degree(first) ||
    Number(kindById.get(second) === "source") - Number(kindById.get(first) === "source") ||
    (first < second ? -1 : first > second ? 1 : 0);

  const visited = new Set<string>();
  const components = [...adjacency.keys()].sort(byPriority).flatMap((rootId) => {
    if (visited.has(rootId)) return [];
    visited.add(rootId);
    const component: { nodeId: string; anchorId: string | null }[] = [{ nodeId: rootId, anchorId: null }];
    for (let index = 0; index < component.length; index += 1) {
      const current = component[index].nodeId;
      [...(adjacency.get(current) ?? [])].sort(byPriority).forEach((neighborId) => {
        if (visited.has(neighborId)) return;
        visited.add(neighborId);
        component.push({ nodeId: neighborId, anchorId: current });
      });
    }
    return [component];
  });
  // sort는 안정 정렬이라 크기가 같은 무리는 허브가 센 순서를 유지한다.
  return components.sort((first, second) => second.length - first.length).flat();
}

export function planGraphReveal({ nodes, links }: { nodes: GraphNode[]; links: GraphLink[] }): GraphRevealPlan {
  const order = revealOrder(nodes, links);
  const durationMs = revealDurationMs(order.length);
  const starts = scheduleStarts(order.length, Math.max(0, durationMs - REVEAL_TAIL_MS));
  return {
    entries: order.map((entry, index) => ({ ...entry, atMs: starts[index] })),
    durationMs
  };
}

export function createGraphReveal(plan: GraphRevealPlan, now: number): GraphRevealState {
  const entries = plan.entries.map(({ nodeId, anchorId, atMs }) => ({ nodeId, anchorId, at: now + atMs }));
  return {
    entries,
    nextIndex: 0,
    startsById: new Map(entries.map((entry) => [entry.nodeId, entry.at])),
    endTime: now + plan.durationMs
  };
}

/** now까지 시각이 된 노드를 내놓는다. */
export function advanceGraphReveal(state: GraphRevealState, now: number) {
  let nextIndex = state.nextIndex;
  while (nextIndex < state.entries.length && state.entries[nextIndex].at <= now) nextIndex += 1;
  return {
    due: state.entries.slice(state.nextIndex, nextIndex),
    state: nextIndex === state.nextIndex ? state : { ...state, nextIndex }
  };
}

/**
 * 연출 중 데이터가 바뀌면(폴링, 새로고침 응답이 조금 늦게 렌더된 경우) 이미 나온 노드는 그대로 두고,
 * 남은 노드를 새 그래프 기준 순서로 다시 세워 남은 시간 안에 내보낸다.
 */
export function mergeGraphReveal({
  state,
  nodes,
  links,
  now
}: {
  state: GraphRevealState;
  nodes: GraphNode[];
  links: GraphLink[];
  now: number;
}): GraphRevealState {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const revealed = state.entries.slice(0, state.nextIndex).filter((entry) => nodeIds.has(entry.nodeId));
  const revealedIds = new Set(revealed.map((entry) => entry.nodeId));
  const remaining = revealOrder(nodes, links).filter((entry) => !revealedIds.has(entry.nodeId));

  const { minBatchIntervalMs, minMergeWindowMs } = GRAPH_REVEAL_MOTION;
  const windowMs = Math.max(state.endTime - REVEAL_TAIL_MS - now, minMergeWindowMs);
  const starts = scheduleStarts(remaining.length, windowMs - minBatchIntervalMs);
  const scheduled = remaining.map((entry, index) => ({ ...entry, at: now + minBatchIntervalMs + starts[index] }));
  const entries = [...revealed, ...scheduled];
  return {
    entries,
    nextIndex: revealed.length,
    startsById: new Map(entries.map((entry) => [entry.nodeId, entry.at])),
    endTime: Math.max(state.endTime, (scheduled.at(-1)?.at ?? now) + REVEAL_TAIL_MS)
  };
}

/** 기준 노드에서 목표 자리 쪽으로 조금 떨어진 출발점. 목표 쪽으로 나와야 노드들의 방향 순서가 꼬이지 않는다. */
export function revealSpawnPosition(anchor: NodePosition, target: NodePosition): NodePosition {
  const deltaX = target.x - anchor.x;
  const deltaY = target.y - anchor.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return target;
  const offset = Math.min(GRAPH_REVEAL_MOTION.spawnOffset, distance);
  return { x: anchor.x + (deltaX / distance) * offset, y: anchor.y + (deltaY / distance) * offset };
}

/** 이번 프레임의 화면 좌표. 나온 시각(at)부터 끝(endTime)까지 연출 좌표에서 본 좌표로 옮겨 가고, 끝에서 본 좌표와 같다. */
export function revealDisplayPosition({
  at,
  endTime,
  now,
  simulated,
  target
}: {
  at: number;
  endTime: number;
  now: number;
  simulated: NodePosition;
  target: NodePosition;
}): NodePosition {
  const span = endTime - at;
  const amount = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - at) / span));
  if (amount >= 1) return target;
  const eased = easeInOutCubic(amount);
  return { x: simulated.x + (target.x - simulated.x) * eased, y: simulated.y + (target.y - simulated.y) * eased };
}

/** 나타난 뒤인지. 계획에 없는 노드는 평소대로 보이는 것으로 본다. */
export function isNodeRevealed(state: GraphRevealState, nodeId: string, now: number) {
  const start = state.startsById.get(nodeId);
  return start === undefined || start <= now;
}

/** 이번 프레임에 평소와 다르게 그릴 노드(아직 안 나온 노드와 나타나는 중인 노드)의 모습. */
export function revealFramesAt(state: GraphRevealState, now: number) {
  const { nodeAppearMs, startScale } = GRAPH_REVEAL_MOTION;
  const frames = new Map<string, NodeEntryFrame>();
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const { nodeId, at } = state.entries[index];
    const elapsed = now - at;
    if (elapsed >= nodeAppearMs) break;
    if (elapsed < 0) {
      frames.set(nodeId, HIDDEN_FRAME);
      continue;
    }
    const amount = elapsed / nodeAppearMs;
    frames.set(nodeId, {
      edge: 1,
      opacity: easeOutCubic(amount),
      scale: startScale + (1 - startScale) * easeOutBack(amount, GRAPH_ENTER_MOTION.bloomOvershoot),
      label: amount * amount,
      glow: 0,
      staticRing: false,
      done: false
    });
  }
  return frames;
}

/** 링크의 이번 프레임 불투명도 배수. 양쪽 노드가 모두 나타난 뒤부터 올라간다. */
export function linkRevealOpacity(state: GraphRevealState, link: GraphLink, now: number) {
  const from = state.startsById.get(link.from) ?? Number.NEGATIVE_INFINITY;
  const to = state.startsById.get(link.to) ?? Number.NEGATIVE_INFINITY;
  const elapsed = now - Math.max(from, to) - GRAPH_REVEAL_MOTION.nodeAppearMs;
  return Math.min(1, Math.max(0, elapsed / GRAPH_REVEAL_MOTION.linkFadeMs));
}
