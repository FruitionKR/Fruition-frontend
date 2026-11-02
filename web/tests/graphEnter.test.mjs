import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const {
  GRAPH_ENTER_MOTION,
  nodeEnterAmount,
  planGraphUpdate,
  scheduleNodeEntries,
  spawnNearNeighbors
} = await import("../src/widgets/graph/lib/graphEnter.ts");

const node = (id, kind = "concept") => ({ id, label: id, kind });
const link = (from, to) => ({ from, to });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("기존 노드는 이전 위치와 이전 기준점을 그대로 이어받는다", () => {
  const plan = planGraphUpdate({
    nodes: [node("a", "source"), node("b")],
    links: [link("a", "b")],
    previousPositions: { a: { x: 10, y: 20 }, b: { x: 40, y: 50 } },
    previousOrigins: { a: { x: 11, y: 21 } },
    layoutPositions: { a: { x: 999, y: 999 }, b: { x: 999, y: 999 } }
  });
  assert.deepEqual(plan.startPositions, { a: { x: 10, y: 20 }, b: { x: 40, y: 50 } });
  assert.deepEqual(plan.originPositions.a, { x: 11, y: 21 });
  // 이전 기준점이 없으면 현재 위치를 기준점으로 삼는다(새 레이아웃 좌표로 끌려가지 않는다).
  assert.deepEqual(plan.originPositions.b, { x: 40, y: 50 });
  assert.deepEqual(plan.addedNodeIds, []);
});

test("새 노드는 원점·새 레이아웃이 아니라 연결된 기존 노드들의 중심 근처에서 시작한다", () => {
  const plan = planGraphUpdate({
    nodes: [node("a", "source"), node("b", "source"), node("c")],
    links: [link("a", "c"), link("b", "c")],
    previousPositions: { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } },
    previousOrigins: {},
    layoutPositions: { c: { x: 0, y: 0 } }
  });
  assert.deepEqual(plan.addedNodeIds, ["c"]);
  const center = { x: 150, y: 100 };
  assert.ok(Math.abs(distance(plan.startPositions.c, center) - GRAPH_ENTER_MOTION.spawnOffset) < 1e-9);
  // 새 노드의 기준점은 태어난 자리다.
  assert.deepEqual(plan.originPositions.c, plan.startPositions.c);
});

test("새 노드끼리만 이어진 경우 먼저 자리 잡은 새 이웃 근처에 둔다(편입: raw → 새 source → 새 concept)", () => {
  const plan = planGraphUpdate({
    nodes: [node("raw", "raw"), node("src", "source"), node("concept")],
    links: [link("raw", "src"), link("src", "concept")],
    previousPositions: { raw: { x: 300, y: 300 } },
    previousOrigins: {},
    layoutPositions: { src: { x: 0, y: 0 }, concept: { x: 0, y: 0 } }
  });
  assert.deepEqual(plan.addedNodeIds, ["src", "concept"]);
  assert.ok(distance(plan.startPositions.src, { x: 300, y: 300 }) <= GRAPH_ENTER_MOTION.spawnOffset + 1e-9);
  assert.ok(distance(plan.startPositions.concept, plan.startPositions.src) <= GRAPH_ENTER_MOTION.spawnOffset + 1e-9);
});

test("이웃이 없는 새 노드는 레이아웃 좌표를 쓴다", () => {
  const plan = planGraphUpdate({
    nodes: [node("a"), node("lonely")],
    links: [],
    previousPositions: { a: { x: 1, y: 1 } },
    previousOrigins: {},
    layoutPositions: { lonely: { x: 77, y: 88 } }
  });
  assert.deepEqual(plan.startPositions.lonely, { x: 77, y: 88 });
});

test("spawnNearNeighbors는 같은 id면 같은 좌표, 다른 id면 다른 방향을 고른다", () => {
  const neighbors = [{ x: 0, y: 0 }];
  assert.deepEqual(spawnNearNeighbors("page_x", neighbors), spawnNearNeighbors("page_x", neighbors));
  assert.notDeepEqual(spawnNearNeighbors("page_x", neighbors), spawnNearNeighbors("page_y", neighbors));
});

test("scheduleNodeEntries는 노드를 차례로 시작하되 큰 묶음도 상한 안에 시작을 끝낸다", () => {
  const few = scheduleNodeEntries(["a", "b", "c"], 1000);
  assert.deepEqual(few, { a: 1000, b: 1000 + GRAPH_ENTER_MOTION.staggerMs, c: 1000 + GRAPH_ENTER_MOTION.staggerMs * 2 });

  const many = scheduleNodeEntries(Array.from({ length: 100 }, (_, index) => `n${index}`), 0);
  assert.equal(many.n0, 0);
  assert.ok(Math.abs(many.n99 - GRAPH_ENTER_MOTION.maxStaggerTotalMs) < 1e-9);
  assert.ok(many.n99 + GRAPH_ENTER_MOTION.durationMs <= 1500, "큰 묶음도 1.5초 안에 다 나타난다");

  assert.deepEqual(scheduleNodeEntries(["solo"], 5), { solo: 5 });
});

test("nodeEnterAmount는 시작 전 0, 끝나면 1이고 ease-out으로 앞쪽이 빠르다", () => {
  assert.equal(nodeEnterAmount(undefined, 0), 1, "등장 대상이 아니면 완전히 보인다");
  assert.equal(nodeEnterAmount(100, 50), 0);
  assert.equal(nodeEnterAmount(0, GRAPH_ENTER_MOTION.durationMs), 1);
  assert.ok(nodeEnterAmount(0, GRAPH_ENTER_MOTION.durationMs / 2) > 0.5);
});
