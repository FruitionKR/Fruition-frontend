import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { GraphLink, GraphNode, NodePosition } from "@/entities/wiki";
import { createGraphSimulation, setActiveSimulationNodes, simulationPositions, tickGraphSimulation } from "../lib/graphPhysics";
import type { GraphSimulation } from "../lib/graphPhysics";
import {
  GRAPH_REVEAL_MOTION,
  advanceGraphReveal,
  createGraphReveal,
  isNodeRevealed,
  linkRevealOpacity,
  mergeGraphReveal,
  planGraphReveal,
  revealDisplayPosition,
  revealFramesAt,
  revealSpawnPosition
} from "../lib/graphReveal";
import type { GraphRevealState } from "../lib/graphReveal";

/**
 * 페이지를 연 뒤 첫 표시 연출을 이미 썼는지. 다른 화면에 갔다 와서 그래프가 다시 마운트돼도
 * 재생하지 않도록 컴포넌트가 아니라 페이지 수명에 둔다.
 */
let hasSettledInitialReveal = false;

type ActiveReveal = {
  state: GraphRevealState;
  /** 나온 노드만 힘을 받는 연출 전용 simulation. 본 simulation은 연출 동안 tick하지 않는다. */
  simulation: GraphSimulation;
  activeNodeIds: Set<string>;
  /** 이번 프레임에 화면에 그릴 좌표. 나온 노드만 있다. */
  displayPositions: Map<string, NodePosition>;
};

/**
 * 새로고침 버튼과 페이지 첫 표시 때 노드가 하나씩 나타나 그래프가 완성되는 연출을 관리한다.
 * rAF 루프(useGraphAnimation)와 performance.now로만 진행하므로 정리할 타이머가 없다.
 */
export function useGraphReveal({
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
  onStart
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  graphSignature: string;
  loading: boolean;
  preferencesReady: boolean;
  reduceMotion: boolean;
  /** 값이 바뀌면 처음부터 다시 재생한다(새로고침 버튼). */
  revealRequest: number;
  simulationRef: MutableRefObject<GraphSimulation | null>;
  draggingNodeIdRef: MutableRefObject<string | null>;
  drawGraphRef: MutableRefObject<() => void>;
  requestAnimationRef: MutableRefObject<() => void>;
  /** 연출이 시작될 때 겹치는 다른 연출(새 노드 등장, 자동 화면 이동)을 지운다. */
  onStart: () => void;
}) {
  const revealRef = useRef<ActiveReveal | null>(null);

  function updateDisplayPositions(reveal: ActiveReveal, now: number) {
    const { entries, nextIndex, endTime } = reveal.state;
    const targets = simulationRef.current?.nodeById;
    const positions = new Map<string, NodePosition>();
    for (let index = 0; index < nextIndex; index += 1) {
      const { nodeId, at } = entries[index];
      const simulated = reveal.simulation.nodeById.get(nodeId);
      const target = targets?.get(nodeId);
      if (simulated && target) positions.set(nodeId, revealDisplayPosition({ at, endTime, now, simulated, target }));
    }
    reveal.displayPositions = positions;
  }

  /** 시각이 된 노드를 연결 노드 근처에서 내보내고 화면 좌표를 갱신한다. 연출이 진행 중이면(끝나는 프레임 포함) true. */
  function advance() {
    const reveal = revealRef.current;
    if (!reveal) return false;
    const now = performance.now();
    if (now >= reveal.state.endTime) {
      revealRef.current = null;
      return true;
    }
    const { due, state } = advanceGraphReveal(reveal.state, now);
    reveal.state = state;
    if (due.length > 0) {
      const targets = simulationRef.current?.nodeById;
      due.forEach(({ nodeId, anchorId }) => {
        const simNode = reveal.simulation.nodeById.get(nodeId);
        const anchor = anchorId ? reveal.simulation.nodeById.get(anchorId) : null;
        const target = targets?.get(nodeId);
        if (simNode && anchor && target) Object.assign(simNode, revealSpawnPosition(anchor, target), { vx: 0, vy: 0 });
        reveal.activeNodeIds.add(nodeId);
      });
      setActiveSimulationNodes(reveal.simulation, reveal.activeNodeIds);
    }
    updateDisplayPositions(reveal, now);
    return true;
  }

  /** 연출을 끝내고 전체를 보여 준다. keepDisplayed면 나온 노드를 지금 화면 자리에 둔 채 본 simulation으로 넘긴다. */
  function finish({ keepDisplayed = false }: { keepDisplayed?: boolean } = {}) {
    const reveal = revealRef.current;
    if (!reveal) return;
    revealRef.current = null;
    if (keepDisplayed) {
      reveal.displayPositions.forEach((position, nodeId) => {
        const simNode = simulationRef.current?.nodeById.get(nodeId);
        if (simNode) Object.assign(simNode, position, { vx: 0, vy: 0 });
      });
    }
    drawGraphRef.current();
    requestAnimationRef.current();
  }

  function createRevealSimulation(startOverrides: Record<string, NodePosition> = {}) {
    const targets = simulationRef.current ? simulationPositions(simulationRef.current) : {};
    return createGraphSimulation({
      nodes,
      links,
      startPositions: { ...targets, ...startOverrides },
      originPositions: targets,
      initialAlpha: GRAPH_REVEAL_MOTION.simAlpha,
      originStrength: GRAPH_REVEAL_MOTION.simTargetStrength
    });
  }

  function start() {
    if (!simulationRef.current || nodes.length === 0 || reduceMotion || document.hidden || draggingNodeIdRef.current) {
      finish();
      return;
    }
    const activeNodeIds = new Set<string>();
    const simulation = createRevealSimulation();
    setActiveSimulationNodes(simulation, activeNodeIds);
    revealRef.current = {
      state: createGraphReveal(planGraphReveal({ nodes, links }), performance.now()),
      simulation,
      activeNodeIds,
      displayPositions: new Map()
    };
    onStart();
    advance();
    drawGraphRef.current();
    requestAnimationRef.current();
  }

  /** 페이지 첫 표시 데이터를 기다리는 동안 앞서 온 일부 노드가 번쩍 보이지 않게 그리지 않는다. */
  function isHoldingNodes() {
    return !hasSettledInitialReveal;
  }

  // 그래프를 그리는 effect 뒤에 실행되도록 useGraphCanvas에서 그 effect 다음에 이 hook을 호출한다.
  useEffect(() => {
    if (hasSettledInitialReveal || loading || !preferencesReady) return;
    hasSettledInitialReveal = true;
    start();
    drawGraphRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, preferencesReady, graphSignature]);

  const handledRevealRequestRef = useRef(revealRequest);
  useEffect(() => {
    if (handledRevealRequestRef.current === revealRequest) return;
    handledRevealRequestRef.current = revealRequest;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest]);

  // 동작 줄이기가 켜지거나 탭이 숨겨지면 곧바로 끝난 상태로 둔다(숨긴 탭에서는 rAF가 멈춰 연출이 진행되지 않는다).
  useEffect(() => {
    if (reduceMotion) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const finishWhenHidden = () => {
      if (document.hidden) finishRef.current();
    };
    document.addEventListener("visibilitychange", finishWhenHidden);
    return () => document.removeEventListener("visibilitychange", finishWhenHidden);
  }, []);

  return {
    isActive: () => revealRef.current !== null,
    isHoldingNodes,
    advance,
    finish,
    /** 진행 중이면 연출 simulation을 한 tick 진행하고 true를 돌려준다(본 simulation은 멈춘다). */
    tick() {
      const reveal = revealRef.current;
      if (!reveal) return false;
      reveal.simulation.simulation.alpha(GRAPH_REVEAL_MOTION.simAlpha);
      tickGraphSimulation(reveal.simulation, false);
      return true;
    },
    /** 그래프 데이터가 바뀌어 본 simulation을 새로 만든 뒤 부른다. 진행 중인 연출에 바뀐 노드를 합친다. */
    mergeAfterGraphChange() {
      const reveal = revealRef.current;
      if (!reveal) return;
      const state = mergeGraphReveal({ state: reveal.state, nodes, links, now: performance.now() });
      const revealed = state.entries.slice(0, state.nextIndex).map((entry) => entry.nodeId);
      const simulation = createRevealSimulation(
        Object.fromEntries(revealed.flatMap((nodeId) => {
          const simNode = reveal.simulation.nodeById.get(nodeId);
          return simNode ? [[nodeId, { x: simNode.x, y: simNode.y }]] : [];
        }))
      );
      const activeNodeIds = new Set(revealed);
      setActiveSimulationNodes(simulation, activeNodeIds);
      revealRef.current = { ...reveal, state, simulation, activeNodeIds };
      updateDisplayPositions(revealRef.current, performance.now());
    },
    /** 워크스페이스 전환처럼 그래프가 통째로 바뀌면 재생을 멈춘다. */
    cancel() {
      revealRef.current = null;
    },
    /** 화면 좌표. 연출 중이 아니거나 아직 안 나온 노드면 null이다. */
    displayPosition: (nodeId: string) => revealRef.current?.displayPositions.get(nodeId) ?? null,
    isNodeHidden(nodeId: string) {
      const reveal = revealRef.current;
      return reveal ? !isNodeRevealed(reveal.state, nodeId, performance.now()) : false;
    },
    framesAt(now: number) {
      const reveal = revealRef.current;
      return reveal ? revealFramesAt(reveal.state, now) : null;
    },
    linkOpacity(link: GraphLink, now: number) {
      const reveal = revealRef.current;
      return reveal ? linkRevealOpacity(reveal.state, link, now) : 1;
    }
  };
}
