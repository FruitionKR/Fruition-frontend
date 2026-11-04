import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const {
  GRAPH_REVEAL_MOTION,
  advanceGraphReveal,
  createGraphReveal,
  isNodeRevealed,
  linkRevealOpacity,
  mergeGraphReveal,
  planGraphReveal,
  revealDisplayPosition,
  revealDurationMs,
  revealFramesAt,
  revealSpawnPosition
} = await import("../src/widgets/graph/lib/graphReveal.ts");
const {
  createGraphSimulation,
  createSourceCenteredNodePositions,
  setActiveSimulationNodes,
  simulationPositions,
  tickGraphSimulation
} = await import("../src/widgets/graph/lib/graphPhysics.ts");

const node = (id, kind = "concept") => ({ id, label: id, kind });
const link = (from, to) => ({ from, to });
const ids = (plan) => plan.entries.map((entry) => entry.nodeId);

/** 허브 하나에 n-1개가 매달리고 그 일부가 서로 이어진 큰 그래프 */
function largeGraph(count) {
  const nodes = Array.from({ length: count }, (_, index) => node(`n${index}`, index === 0 ? "source" : "concept"));
  const links = nodes.slice(1).map((current, index) => link(`n${Math.floor(index / 4)}`, current.id));
  return { nodes, links };
}

test("빈 그래프는 등장할 것이 없고 시간도 0이다", () => {
  const plan = planGraphReveal({ nodes: [], links: [] });
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.durationMs, 0);
});

test("노드 1개는 곧바로 시작하고 기준 이웃이 없다", () => {
  const plan = planGraphReveal({ nodes: [node("a")], links: [] });
  assert.deepEqual(plan.entries, [{ nodeId: "a", anchorId: null, atMs: 0 }]);
  assert.ok(plan.durationMs > 0 && plan.durationMs <= GRAPH_REVEAL_MOTION.maxTotalMs);
});

test("모든 노드가 한 번씩 포함된다(끊어진 무리와 고아 노드 포함)", () => {
  const nodes = ["a", "b", "c", "d", "e", "orphan1", "orphan2"].map((id) => node(id));
  const links = [link("a", "b"), link("b", "c"), link("d", "e")];
  const order = ids(planGraphReveal({ nodes, links }));
  assert.equal(order.length, nodes.length);
  assert.deepEqual([...order].sort(), nodes.map((current) => current.id).sort());
});

test("연결이 가장 많은 노드(허브)부터 시작하고, 큰 무리 뒤에 작은 무리, 고아는 맨 뒤에 나온다", () => {
  const nodes = ["orphan", "small1", "small2", "leaf1", "leaf2", "hub", "leaf3"].map((id) => node(id));
  const links = [link("small1", "small2"), link("hub", "leaf1"), link("hub", "leaf2"), link("hub", "leaf3")];
  const order = ids(planGraphReveal({ nodes, links }));
  assert.equal(order[0], "hub");
  assert.ok(order.indexOf("leaf3") < order.indexOf("small1"));
  assert.ok(order.indexOf("leaf3") < order.indexOf("small2"));
  assert.equal(order.at(-1), "orphan");
});

test("각 노드의 기준 이웃은 먼저 나타난 연결 노드이고, 무리의 첫 노드만 기준이 없다", () => {
  const nodes = ["a", "b", "c", "d", "x", "y", "orphan"].map((id) => node(id));
  const links = [link("a", "b"), link("b", "c"), link("c", "d"), link("x", "y")];
  const plan = planGraphReveal({ nodes, links });
  const position = new Map(plan.entries.map((entry, index) => [entry.nodeId, index]));
  const connected = (first, second) => links.some((current) =>
    (current.from === first && current.to === second) || (current.from === second && current.to === first));
  const withoutAnchor = plan.entries.filter((entry) => entry.anchorId === null).map((entry) => entry.nodeId);
  assert.equal(withoutAnchor.length, 3); // 무리 2개 + 고아 1개
  plan.entries.filter((entry) => entry.anchorId !== null).forEach((entry) => {
    assert.ok(position.get(entry.anchorId) < position.get(entry.nodeId));
    assert.ok(connected(entry.anchorId, entry.nodeId));
  });
});

test("없는 노드를 가리키는 링크·자기 자신 링크가 있어도 순서가 깨지지 않는다", () => {
  const plan = planGraphReveal({ nodes: [node("a"), node("b")], links: [link("a", "ghost"), link("a", "a"), link("a", "b")] });
  assert.deepEqual(ids(plan).sort(), ["a", "b"]);
  assert.ok(plan.entries.every((entry) => entry.anchorId !== "ghost" && entry.anchorId !== entry.nodeId));
});

test("같은 입력이면 입력 순서가 달라도 같은 순서를 낸다", () => {
  const { nodes, links } = largeGraph(50);
  const first = ids(planGraphReveal({ nodes, links }));
  const second = ids(planGraphReveal({ nodes: [...nodes].reverse(), links: [...links].reverse() }));
  assert.deepEqual(first, second);
});

test("어떤 크기에서도 전체 시간은 상한 안이고, 충분히 크면 하한 이상이다", () => {
  assert.ok(GRAPH_REVEAL_MOTION.maxTotalMs <= 3000);
  [1, 2, 5, 8, 20, 100, 500, 1000, 5000, 20000].forEach((count) => {
    const duration = revealDurationMs(count);
    assert.ok(duration <= GRAPH_REVEAL_MOTION.maxTotalMs, `${count}: ${duration}`);
    if (count >= 12) assert.ok(duration >= GRAPH_REVEAL_MOTION.minTotalMs, `${count}: ${duration}`);
  });
  assert.ok(revealDurationMs(1000) >= revealDurationMs(10));
});

test("마지막 노드와 링크까지 전체 시간 안에 끝나고, 시작 시각은 줄어들지 않는다", () => {
  [2, 5, 30, 300, 3000].forEach((count) => {
    const plan = planGraphReveal(largeGraph(count));
    const last = plan.entries.at(-1).atMs;
    assert.ok(last + GRAPH_REVEAL_MOTION.nodeAppearMs + GRAPH_REVEAL_MOTION.linkFadeMs <= plan.durationMs + 0.001, `${count}`);
    assert.ok(last + GRAPH_REVEAL_MOTION.settleTailMs <= plan.durationMs + 0.001, `${count}`);
    plan.entries.reduce((previous, entry) => {
      assert.ok(entry.atMs >= previous);
      return entry.atMs;
    }, 0);
  });
});

test("대규모 그래프는 묶음으로 나타나고 묶음 사이 간격이 물리 tick보다 짧지 않다", () => {
  const plan = planGraphReveal(largeGraph(3000));
  const batches = [...new Set(plan.entries.map((entry) => entry.atMs))];
  assert.ok(batches.length < 3000 / 10, `묶음 수 ${batches.length}`);
  assert.ok(batches.length >= 20, `묶음 수 ${batches.length}`);
  batches.slice(1).forEach((time, index) => {
    assert.ok(time - batches[index] >= GRAPH_REVEAL_MOTION.minBatchIntervalMs - 0.001);
  });
});

test("적은 노드는 한 번에 하나씩 나타나고 간격이 지나치게 늘어지지 않는다", () => {
  const plan = planGraphReveal(largeGraph(5));
  const times = plan.entries.map((entry) => entry.atMs);
  assert.equal(new Set(times).size, 5);
  assert.ok(times[1] - times[0] <= GRAPH_REVEAL_MOTION.maxStepMs);
});

test("advanceGraphReveal은 시각이 된 노드만 한 번씩 내놓고 원래 상태를 바꾸지 않는다", () => {
  const plan = planGraphReveal(largeGraph(5));
  const state = createGraphReveal(plan, 1000);
  const first = advanceGraphReveal(state, 1000);
  assert.deepEqual(first.due.map((entry) => entry.nodeId), [plan.entries[0].nodeId]);
  assert.equal(state.nextIndex, 0);
  assert.deepEqual(advanceGraphReveal(first.state, 1000).due, []);
  const all = advanceGraphReveal(first.state, 1000 + plan.durationMs);
  assert.equal(all.due.length, 4);
});

test("아직 시각이 안 된 노드는 숨겨지고 눌리지 않으며, 나타나는 동안 작게 시작해 커진다", () => {
  const plan = planGraphReveal(largeGraph(5));
  const state = createGraphReveal(plan, 1000);
  const lastEntry = plan.entries.at(-1);
  const lastAt = 1000 + lastEntry.atMs;
  assert.equal(isNodeRevealed(state, lastEntry.nodeId, lastAt - 1), false);
  assert.equal(isNodeRevealed(state, lastEntry.nodeId, lastAt), true);

  assert.equal(revealFramesAt(state, lastAt - 1).get(lastEntry.nodeId).opacity, 0);
  const early = revealFramesAt(state, lastAt + 10).get(lastEntry.nodeId);
  const later = revealFramesAt(state, lastAt + GRAPH_REVEAL_MOTION.nodeAppearMs * 0.7).get(lastEntry.nodeId);
  assert.ok(early.scale < later.scale);
  assert.ok(early.opacity < later.opacity);
  assert.equal(early.glow, 0);
  // 다 나타난 노드는 평소 모습으로 그리도록 목록에서 빠진다.
  assert.equal(revealFramesAt(state, lastAt + GRAPH_REVEAL_MOTION.nodeAppearMs).has(lastEntry.nodeId), false);
});

test("링크는 양쪽 노드가 모두 나타난 뒤에야 보이기 시작한다", () => {
  const nodes = [node("hub"), node("a"), node("b")];
  const links = [link("hub", "a"), link("a", "b"), link("hub", "b")];
  const plan = planGraphReveal({ nodes, links });
  const state = createGraphReveal(plan, 0);
  const atOf = new Map(plan.entries.map((entry) => [entry.nodeId, entry.atMs]));
  links.forEach((current) => {
    const bothAppeared = Math.max(atOf.get(current.from), atOf.get(current.to)) + GRAPH_REVEAL_MOTION.nodeAppearMs;
    assert.equal(linkRevealOpacity(state, current, bothAppeared - 1), 0);
    assert.equal(linkRevealOpacity(state, current, bothAppeared), 0);
    assert.ok(linkRevealOpacity(state, current, bothAppeared + GRAPH_REVEAL_MOTION.linkFadeMs / 2) > 0);
    assert.equal(linkRevealOpacity(state, current, bothAppeared + GRAPH_REVEAL_MOTION.linkFadeMs), 1);
  });
});

test("연출 중 데이터가 바뀌면 이미 나타난 노드는 두고, 새 노드는 남은 시간 안에 합류하며, 사라진 노드는 빠진다", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => node(id));
  const links = [link("a", "b"), link("b", "c"), link("c", "d")];
  const plan = planGraphReveal({ nodes, links });
  const started = createGraphReveal(plan, 0);
  const now = plan.entries[1].atMs + 1;
  const { state } = advanceGraphReveal(started, now);
  const shownBefore = plan.entries.slice(0, 2).map((entry) => entry.nodeId);
  const removed = plan.entries.at(-1).nodeId;

  const nextNodes = [...nodes.filter((current) => current.id !== removed), node("new")];
  const nextLinks = [...links.filter((current) => current.from !== removed && current.to !== removed), link("a", "new")];
  const merged = mergeGraphReveal({ state, nodes: nextNodes, links: nextLinks, now });

  const mergedIds = merged.entries.map((entry) => entry.nodeId);
  assert.deepEqual([...mergedIds].sort(), nextNodes.map((current) => current.id).sort());
  shownBefore.forEach((nodeId) => assert.equal(isNodeRevealed(merged, nodeId, now), true));
  assert.equal(isNodeRevealed(merged, "new", now), false);
  assert.ok(isNodeRevealed(merged, "new", merged.endTime));
  assert.deepEqual(merged.entries.slice(0, merged.nextIndex).map((entry) => entry.nodeId), shownBefore);
  assert.ok(merged.endTime <= now + GRAPH_REVEAL_MOTION.minMergeWindowMs + GRAPH_REVEAL_MOTION.settleTailMs || merged.endTime === state.endTime);
});

test("simulation을 일부 노드로 좁혀도 나머지 좌표는 보존되고, 나타난 노드끼리만 힘을 받는다", () => {
  const nodes = [node("a", "source"), node("b"), node("c")];
  const links = [link("a", "b"), link("b", "c")];
  const positions = { a: { x: 400, y: 300 }, b: { x: 500, y: 300 }, c: { x: 900, y: 900 } };
  const graphSimulation = createGraphSimulation({ nodes, links, startPositions: positions, originPositions: positions });

  setActiveSimulationNodes(graphSimulation, new Set(["a", "b"]));
  for (let index = 0; index < 20; index += 1) tickGraphSimulation(graphSimulation, false);

  const hidden = graphSimulation.nodeById.get("c");
  assert.deepEqual({ x: hidden.x, y: hidden.y }, positions.c);
  assert.equal(graphSimulation.simulation.nodes().length, 2);
  assert.equal(graphSimulation.simulation.force("link").links().length, 1);

  setActiveSimulationNodes(graphSimulation, new Set(["a", "b", "c"]));
  assert.equal(graphSimulation.simulation.nodes().length, 3);
  assert.equal(graphSimulation.simulation.force("link").links().length, 2);
});

test("빈 집합으로 좁혀도 tick이 터지지 않는다", () => {
  const nodes = [node("a"), node("b")];
  const positions = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const graphSimulation = createGraphSimulation({ nodes, links: [link("a", "b")], startPositions: positions, originPositions: positions });
  setActiveSimulationNodes(graphSimulation, new Set());
  assert.equal(tickGraphSimulation(graphSimulation, false), true);
});

test("출발점은 기준 노드에서 목표 쪽으로 떨어져 있고, 목표가 더 가까우면 목표를 넘지 않는다", () => {
  const anchor = { x: 100, y: 100 };
  const far = revealSpawnPosition(anchor, { x: 1100, y: 100 });
  assert.deepEqual(far, { x: 100 + GRAPH_REVEAL_MOTION.spawnOffset, y: 100 });
  assert.deepEqual(revealSpawnPosition(anchor, { x: 110, y: 100 }), { x: 110, y: 100 });
  assert.deepEqual(revealSpawnPosition(anchor, anchor), anchor);
});

test("화면 좌표는 연출 좌표에서 시작해 끝에서 정확히 본 좌표가 된다", () => {
  const simulated = { x: 0, y: 0 };
  const target = { x: 100.123456, y: -50.654321 };
  const at = (now, start = 100) => revealDisplayPosition({ at: start, endTime: 1100, now, simulated, target });
  assert.deepEqual(at(100), simulated);
  const middle = at(600);
  assert.ok(middle.x > 0 && middle.x < target.x);
  assert.deepEqual(at(1100), target);
  assert.deepEqual(at(5000), target);
  assert.deepEqual(at(1100, 1100), target);
});

test("연출 simulation을 돌려도 본 simulation 좌표는 그대로라 끝난 배치가 연출 전과 같다", () => {
  const sources = Array.from({ length: 6 }, (_, index) => node(`s${index}`, "source"));
  const concepts = Array.from({ length: 60 }, (_, index) => node(`c${index}`));
  const nodes = [...sources, ...concepts, node("orphan")];
  const links = concepts.map((concept, index) => link(`s${index % 6}`, concept.id));
  const origin = createSourceCenteredNodePositions(nodes, links);
  const main = createGraphSimulation({ nodes, links, startPositions: origin, originPositions: origin });
  while (tickGraphSimulation(main, false));
  const before = simulationPositions(main);

  const targets = simulationPositions(main);
  const reveal = createGraphSimulation({
    nodes,
    links,
    startPositions: targets,
    originPositions: targets,
    initialAlpha: GRAPH_REVEAL_MOTION.simAlpha,
    originStrength: GRAPH_REVEAL_MOTION.simTargetStrength
  });
  let state = createGraphReveal(planGraphReveal({ nodes, links }), 0);
  const active = new Set();
  setActiveSimulationNodes(reveal, active);
  for (let now = 0; now <= state.endTime; now += 32) {
    const step = advanceGraphReveal(state, now);
    state = step.state;
    step.due.forEach((entry) => {
      if (entry.anchorId) Object.assign(reveal.nodeById.get(entry.nodeId), revealSpawnPosition(reveal.nodeById.get(entry.anchorId), targets[entry.nodeId]));
      active.add(entry.nodeId);
    });
    if (step.due.length > 0) setActiveSimulationNodes(reveal, active);
    reveal.simulation.alpha(GRAPH_REVEAL_MOTION.simAlpha);
    tickGraphSimulation(reveal, false);
  }

  assert.deepEqual(simulationPositions(main), before);
  state.entries.forEach(({ nodeId, at }) => {
    const shown = revealDisplayPosition({ at, endTime: state.endTime, now: state.endTime, simulated: reveal.nodeById.get(nodeId), target: targets[nodeId] });
    assert.deepEqual(shown, before[nodeId]);
  });
  // 연출 simulation이 실제로 움직였어야 의미가 있다.
  const moved = nodes.some(({ id }) => Math.hypot(reveal.nodeById.get(id).x - before[id].x, reveal.nodeById.get(id).y - before[id].y) > 1);
  assert.ok(moved);
});
