import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const {
  entryFramesAt,
  GRAPH_ENTER_MOTION,
  NEW_NODE_GLOW_LIMIT,
  nodeEntryFrame,
  shouldSuppressEntryGlow,
  isInitialGraphDataChange,
  planGraphUpdate,
  revealPan,
  scheduleNodeEntries,
  spawnNearNeighbors
} = await import("../src/widgets/graph/lib/graphEnter.ts");
const { GRAPH_CENTER } = await import("../src/entities/graph/lib/graphBuilder.ts");
const { viewportWorldScale } = await import("../src/widgets/graph/lib/graphGeometry.ts");

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

test("새 노드끼리 이어지면 기존 노드에 가까운 순서(배치된 순서)로 돌려준다", () => {
  const plan = planGraphUpdate({
    nodes: [node("concept"), node("src", "source"), node("raw", "raw")],
    links: [link("raw", "src"), link("src", "concept")],
    previousPositions: { raw: { x: 0, y: 0 } },
    previousOrigins: {},
    layoutPositions: {}
  });
  assert.deepEqual(plan.addedNodeIds, ["src", "concept"]);
});

test("scheduleNodeEntries는 노드를 차례로 시작하되 큰 묶음도 상한 안에 시작을 끝낸다", () => {
  const { staggerMs, maxStaggerTotalMs, edgeDrawMs, bloomMs } = GRAPH_ENTER_MOTION;
  assert.ok(staggerMs >= 60 && staggerMs <= 90);
  const few = scheduleNodeEntries(["a", "b", "c"], 1000);
  assert.deepEqual(few, { a: 1000, b: 1000 + staggerMs, c: 1000 + staggerMs * 2 });

  const many = scheduleNodeEntries(Array.from({ length: 100 }, (_, index) => `n${index}`), 0);
  assert.equal(many.n0, 0);
  assert.ok(Math.abs(many.n99 - maxStaggerTotalMs) < 1e-9);
  assert.ok(many.n99 + edgeDrawMs + bloomMs <= 2000, "큰 묶음도 약 2초 안에 다 피어난다");

  assert.deepEqual(scheduleNodeEntries(["solo"], 5), { solo: 5 });
});

test("nodeEntryFrame: 링크가 먼저 뻗고, 노드가 피어나고, 라벨이 뒤따르고, 강조가 서서히 사라진다", () => {
  const { edgeDrawMs, bloomMs, labelDelayMs, labelFadeMs, glowMs } = GRAPH_ENTER_MOTION;
  const at = (elapsed) => nodeEntryFrame(0, elapsed, false);

  assert.equal(nodeEntryFrame(100, 50, false).edge, 0, "시작 전에는 아무것도 없다");
  const drawing = at(edgeDrawMs / 2);
  assert.ok(drawing.edge > 0 && drawing.edge < 1);
  assert.equal(drawing.opacity, 0, "링크가 뻗는 동안 노드는 아직 안 보인다");

  const blooming = at(edgeDrawMs + bloomMs * 0.6);
  assert.equal(blooming.edge, 1);
  assert.ok(blooming.opacity > 0.5);
  assert.ok(blooming.scale > 1, "easeOutBack으로 살짝 넘쳤다 돌아온다");
  assert.equal(at(edgeDrawMs + labelDelayMs - 1).label, 0, "라벨은 노드보다 늦게 나온다");

  const settled = at(edgeDrawMs + Math.max(bloomMs, labelDelayMs + labelFadeMs));
  assert.deepEqual([settled.opacity, settled.scale, settled.label], [1, 1, 1]);
  assert.ok(settled.glow > 0, "강조는 노드가 다 핀 뒤에도 남아 있다");
  assert.equal(at(edgeDrawMs + glowMs).glow, 0);
  assert.equal(at(edgeDrawMs + glowMs).done, true);
  assert.equal(at(edgeDrawMs + glowMs - 1).done, false);
});

test("nodeEntryFrame(동작 줄이기): 곧바로 제자리에 나타나고 고정 강조 링만 잠시 보인다", () => {
  const { reducedHighlightMs } = GRAPH_ENTER_MOTION;
  const frame = nodeEntryFrame(0, 0, true);
  assert.deepEqual(
    [frame.edge, frame.opacity, frame.scale, frame.label, frame.glow, frame.staticRing],
    [1, 1, 1, 1, 1, true]
  );
  assert.equal(nodeEntryFrame(0, reducedHighlightMs - 1, true).glow, 1, "강조가 깜빡이거나 줄어들지 않는다");
  assert.equal(nodeEntryFrame(0, reducedHighlightMs, true).done, true);
});

test("revealPan: 새 노드가 하나라도 보이면 카메라를 움직이지 않는다", () => {
  const viewport = { width: 1000, height: 700 };
  const pan = { x: 0, y: 0 };
  assert.equal(revealPan({ viewport, pan, zoom: 1, positions: [GRAPH_CENTER, { x: 1e5, y: 0 }] }), null);
  assert.equal(revealPan({ viewport, pan, zoom: 1, positions: [] }), null);
});

test("revealPan: 새 노드가 모두 화면 밖이면 확대 없이 중심이 화면 안 여백까지만 오도록 옮긴다", () => {
  const viewport = { width: 1000, height: 700 };
  const pan = { x: 0, y: 0 };
  const zoom = 2;
  const far = { x: GRAPH_CENTER.x + 1000, y: GRAPH_CENTER.y };
  const next = revealPan({ viewport, pan, zoom, positions: [far] });
  assert.ok(next);
  assert.equal(next.y, 0, "세로로는 이미 화면 안이라 움직이지 않는다");
  const scale = viewportWorldScale(viewport, zoom);
  const screenX = viewport.width / 2 + next.x + (far.x - GRAPH_CENTER.x) * scale;
  assert.ok(Math.abs(screenX - viewport.width * (1 - GRAPH_ENTER_MOTION.revealMargin)) < 1e-6);
});

test("entryFramesAt은 등장 중인 노드마다 nodeEntryFrame과 같은 모습을 한 번씩 계산한다", () => {
  const starts = { a: 0, b: 100 };
  const frames = entryFramesAt(starts, 400, false, false);
  assert.equal(frames.size, 2);
  assert.deepEqual(frames.get("a"), nodeEntryFrame(0, 400, false));
  assert.deepEqual(frames.get("b"), nodeEntryFrame(100, 400, false));
  assert.ok(frames.get("a").glow > 0, "작은 묶음은 강조를 그대로 그린다");
});

test("강조를 끄면 glow만 0이고 피어나는 연출(scale·opacity·edge·label)은 그대로다", () => {
  const frame = entryFramesAt({ a: 0 }, 400, false, true).get("a");
  const original = nodeEntryFrame(0, 400, false);
  assert.deepEqual(frame, { ...original, glow: 0 });
  assert.equal(entryFramesAt({ a: 0 }, 400, true, true).get("a").glow, 0, "동작 줄이기의 고정 링도 끈다");
});

test("한 번에 등장하는 노드가 한도를 넘으면 강조를 끄고, 대기열이 빌 때까지 끈 채로 둔다", () => {
  assert.equal(shouldSuppressEntryGlow(NEW_NODE_GLOW_LIMIT, false), false);
  assert.equal(shouldSuppressEntryGlow(NEW_NODE_GLOW_LIMIT + 1, false), true);
  assert.equal(shouldSuppressEntryGlow(3, true), true, "끝나는 노드가 빠져 수가 줄어도 남은 노드에 강조가 갑자기 켜지지 않는다");
  assert.equal(shouldSuppressEntryGlow(0, true), false, "대기열이 비면 다음 묶음은 다시 판단한다");
});

test("문서가 위키 그래프보다 늦게 와 loading이 끝나는 렌더에 추가된 원본 노드는 새 노드가 아니다", () => {
  const change = (loading, wasLoading, isHoldingNodes = false) => isInitialGraphDataChange({ loading, wasLoading, isHoldingNodes });
  assert.equal(change(true, true), true, "아직 기다리는 중");
  assert.equal(change(false, true), true, "기다림이 끝난 바로 그 렌더(첫 로드·워크스페이스 전환)");
  assert.equal(change(false, false, true), true, "첫 표시 연출 전(동작 줄이기·숨긴 탭은 연출 없이 끝난다)");
  assert.equal(change(false, false), false, "표시가 끝난 뒤 추가된 노드는 새 노드");
});

test("직전 렌더의 loading은 그래프 갱신 effect가 읽은 다음에 바뀐다", () => {
  const source = readFileSync(new URL("../src/widgets/graph/model/useGraphCanvas.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("wasLoading: wasLoadingRef.current") < source.indexOf("wasLoadingRef.current = loading;"));
  assert.match(source, /isHoldingNodes: reveal\.isHoldingNodes\(\) \}\)\) \{\n\s*\/\/ 동작 줄이기여도 시작 시각은 남긴다/);
});
