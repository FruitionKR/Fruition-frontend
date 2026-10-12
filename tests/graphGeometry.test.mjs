import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });

const {
  GRAPH_PAN_MIN_VISIBLE,
  GRAPH_RESIZE_PADDING,
  clampGraphPan,
  clampGraphPosition,
  graphNodeBounds,
  graphViewportRect,
  resizeGraphPan,
  viewportWorldScale
} = await import("../src/widgets/graph/lib/graphGeometry.ts");
const { GRAPH_CENTER } = await import("../src/entities/graph/lib/graph.ts");

const viewport = { width: 1000, height: 700 };

/** 그래프 좌표 → 캔버스 px (graphToCanvasPosition과 같은 식) */
function toScreen(position, pan, zoom) {
  const scale = viewportWorldScale(viewport, zoom);
  return {
    x: viewport.width / 2 + pan.x + (position.x - GRAPH_CENTER.x) * scale,
    y: viewport.height / 2 + pan.y + (position.y - GRAPH_CENTER.y) * scale
  };
}

test("graphViewportRect는 화면 네 귀퉁이를 그래프 좌표로 되돌린다", () => {
  const pan = { x: 120, y: -40 };
  const zoom = 1.7;
  const rect = graphViewportRect({ viewport, pan, zoom });
  const topLeft = toScreen({ x: rect.minX, y: rect.minY }, pan, zoom);
  const bottomRight = toScreen({ x: rect.maxX, y: rect.maxY }, pan, zoom);
  assert.ok(Math.abs(topLeft.x) < 1e-9 && Math.abs(topLeft.y) < 1e-9);
  assert.ok(Math.abs(bottomRight.x - viewport.width) < 1e-9 && Math.abs(bottomRight.y - viewport.height) < 1e-9);
});

test("노드 위치는 보이는 화면 안이면 그대로 둔다(고정 상자 밖이어도)", () => {
  const pan = { x: 300, y: 200 };
  const zoom = 0.62;
  const rect = graphViewportRect({ viewport, pan, zoom });
  const inside = { x: rect.minX + 30, y: rect.minY + 30 };
  assert.ok(inside.x < 0 && inside.y < 0, "예전 고정 상자 기준이면 잘렸을 위치");
  assert.deepEqual(clampGraphPosition({ position: inside, viewport, pan, zoom, nodeRadius: 7 }), inside);
});

test("노드 위치는 화면 가장자리에서 반지름(px)만큼 안쪽으로 clamp된다", () => {
  const pan = { x: -50, y: 80 };
  const zoom = 2;
  const clamped = clampGraphPosition({ position: { x: 1e6, y: -1e6 }, viewport, pan, zoom, nodeRadius: 8 });
  const screen = toScreen(clamped, pan, zoom);
  assert.ok(Math.abs(screen.x - (viewport.width - 8)) < 1e-6);
  assert.ok(Math.abs(screen.y - 8) < 1e-6);
});

test("화면이 노드보다 좁으면 해당 축은 화면 중앙에 둔다", () => {
  const tiny = { width: 10, height: 700 };
  const rect = graphViewportRect({ viewport: tiny, pan: { x: 0, y: 0 }, zoom: 1 });
  const clamped = clampGraphPosition({ position: { x: 9999, y: GRAPH_CENTER.y }, viewport: tiny, pan: { x: 0, y: 0 }, zoom: 1, nodeRadius: 8 });
  assert.equal(clamped.x, (rect.minX + rect.maxX) / 2);
});

test("graphNodeBounds는 노드 분포의 bbox를 만들고 노드가 없으면 null", () => {
  assert.equal(graphNodeBounds([]), null);
  assert.deepEqual(
    graphNodeBounds([{ x: 10, y: 50 }, { x: -20, y: 5 }, { x: NaN, y: 0 }, { x: 40, y: 30 }]),
    { minX: -20, minY: 5, maxX: 40, maxY: 50 }
  );
});

test("노드가 없으면 pan을 제한하지 않는다", () => {
  const pan = { x: 99999, y: -99999 };
  assert.deepEqual(clampGraphPan({ viewport, pan, zoom: 1, bounds: null }), pan);
});

test("pan은 노드 bbox가 화면에 최소 80px 남도록 제한된다", () => {
  const bounds = { minX: 100, minY: 100, maxX: 500, maxY: 400 };
  const zoom = 1.3;
  const farRight = clampGraphPan({ viewport, pan: { x: 1e6, y: 1e6 }, zoom, bounds });
  const leftEdge = toScreen({ x: bounds.minX, y: bounds.minY }, farRight, zoom);
  assert.ok(Math.abs(leftEdge.x - (viewport.width - GRAPH_PAN_MIN_VISIBLE)) < 1e-6);
  assert.ok(Math.abs(leftEdge.y - (viewport.height - GRAPH_PAN_MIN_VISIBLE)) < 1e-6);

  const farLeft = clampGraphPan({ viewport, pan: { x: -1e6, y: -1e6 }, zoom, bounds });
  const rightEdge = toScreen({ x: bounds.maxX, y: bounds.maxY }, farLeft, zoom);
  assert.ok(Math.abs(rightEdge.x - GRAPH_PAN_MIN_VISIBLE) < 1e-6);
  assert.ok(Math.abs(rightEdge.y - GRAPH_PAN_MIN_VISIBLE) < 1e-6);
});

test("범위 안의 pan은 그대로 두고, 노드 하나여도 범위가 뒤집히지 않는다", () => {
  const bounds = { minX: 200, minY: 200, maxX: 200, maxY: 200 };
  const pan = { x: 10, y: -20 };
  assert.deepEqual(clampGraphPan({ viewport, pan, zoom: 1, bounds }), pan);

  const narrow = { width: 100, height: 100 };
  const clamped = clampGraphPan({ viewport: narrow, pan: { x: 500, y: -500 }, zoom: 1, bounds });
  assert.ok(Number.isFinite(clamped.x) && Number.isFinite(clamped.y));
});

/** 임의 viewport 기준 그래프 좌표 → 캔버스 px */
function toScreenIn(vp, position, pan, zoom) {
  const scale = viewportWorldScale(vp, zoom);
  return {
    x: vp.width / 2 + pan.x + (position.x - GRAPH_CENTER.x) * scale,
    y: vp.height / 2 + pan.y + (position.y - GRAPH_CENTER.y) * scale
  };
}

/** 화면 중심이 가리키는 그래프 좌표 */
function centerGraphPoint(vp, pan, zoom) {
  const rect = graphViewportRect({ viewport: vp, pan, zoom });
  return { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
}

const wide = { width: 1400, height: 900 };

test("리사이즈 후 전체 노드가 들어가면 오른쪽 끝 노드가 패딩 안에 보이도록 최소 이동한다", () => {
  const zoom = 1;
  const pan = { x: 0, y: 0 };
  // 넓은 화면에서 오른쪽 가장자리(x=1380px)에 둔 노드 + 중앙 노드
  const edge = { x: GRAPH_CENTER.x + 680, y: GRAPH_CENTER.y };
  const positions = [edge, { x: GRAPH_CENTER.x, y: GRAPH_CENTER.y }];
  const narrow = { width: 1000, height: 900 }; // 왼쪽 사이드바를 펼친 상태
  const next = resizeGraphPan({ previousViewport: wide, viewport: narrow, pan, zoom, positions });
  const screen = toScreenIn(narrow, edge, next, zoom);
  assert.ok(Math.abs(screen.x - (narrow.width - GRAPH_RESIZE_PADDING.x)) < 1e-6, `edge x=${screen.x}`);
  for (const position of positions) {
    const p = toScreenIn(narrow, position, next, zoom);
    assert.ok(p.x >= GRAPH_RESIZE_PADDING.x - 1e-6 && p.x <= narrow.width - GRAPH_RESIZE_PADDING.x + 1e-6);
    assert.ok(p.y >= GRAPH_RESIZE_PADDING.y - 1e-6 && p.y <= narrow.height - GRAPH_RESIZE_PADDING.y + 1e-6);
  }
});

test("리사이즈 후에도 모두 보이면 화면 중심 기준 pan을 그대로 둔다", () => {
  const zoom = 1;
  const pan = { x: 30, y: -10 };
  const positions = [{ x: GRAPH_CENTER.x - 50, y: GRAPH_CENTER.y }, { x: GRAPH_CENTER.x + 50, y: GRAPH_CENTER.y + 20 }];
  const next = resizeGraphPan({ previousViewport: wide, viewport: { width: 1200, height: 900 }, pan, zoom, positions });
  assert.deepEqual(next, pan);
});

test("전체는 안 들어가도 리사이즈 전에 보이던 노드들이 들어가면 그것들을 보이게 한다", () => {
  const zoom = 1;
  const pan = { x: 0, y: 0 };
  const visibleEdge = { x: GRAPH_CENTER.x + 650, y: GRAPH_CENTER.y };
  const visibleCenter = { x: GRAPH_CENTER.x, y: GRAPH_CENTER.y };
  const offscreen = { x: GRAPH_CENTER.x - 5000, y: GRAPH_CENTER.y }; // 원래도 화면 밖
  const narrow = { width: 1000, height: 900 };
  const next = resizeGraphPan({ previousViewport: wide, viewport: narrow, pan, zoom, positions: [visibleEdge, visibleCenter, offscreen] });
  for (const position of [visibleEdge, visibleCenter]) {
    const p = toScreenIn(narrow, position, next, zoom);
    assert.ok(p.x >= GRAPH_RESIZE_PADDING.x - 1e-6 && p.x <= narrow.width - GRAPH_RESIZE_PADDING.x + 1e-6, `x=${p.x}`);
  }
});

test("어느 쪽도 들어가지 않으면 리사이즈 전 화면 중심의 그래프 좌표를 새 화면 중심에 유지한다", () => {
  const zoom = 3;
  const pan = { x: 120, y: -60 };
  const positions = [
    { x: GRAPH_CENTER.x - 400, y: GRAPH_CENTER.y - 300 },
    { x: GRAPH_CENTER.x + 400, y: GRAPH_CENTER.y + 300 },
    { x: GRAPH_CENTER.x - 30, y: GRAPH_CENTER.y + 10 },
    { x: GRAPH_CENTER.x + 20, y: GRAPH_CENTER.y - 30 }
  ];
  const narrow = { width: 700, height: 600 }; // fit 배율도 함께 줄어드는 크기
  const before = centerGraphPoint(wide, pan, zoom);
  const next = resizeGraphPan({ previousViewport: wide, viewport: narrow, pan, zoom, positions });
  const after = centerGraphPoint(narrow, next, zoom);
  assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6);
});

test("중심 유지 결과도 노드 bbox가 화면에서 사라지지 않게 clampGraphPan을 적용한다", () => {
  const zoom = 4;
  // 대각선 두 노드: bbox의 빈 귀퉁이만 화면에 걸쳐 있고 보이던 노드는 없다.
  const positions = [{ x: GRAPH_CENTER.x + 300, y: GRAPH_CENTER.y - 300 }, { x: GRAPH_CENTER.x - 300, y: GRAPH_CENTER.y + 300 }];
  const scale = viewportWorldScale(wide, zoom);
  const pan = { x: GRAPH_PAN_MIN_VISIBLE - wide.width / 2 - 300 * scale, y: GRAPH_PAN_MIN_VISIBLE - wide.height / 2 - 300 * scale };
  const narrow = { width: 500, height: 900 };
  const next = resizeGraphPan({ previousViewport: wide, viewport: narrow, pan, zoom, positions });
  const ratio = viewportWorldScale(narrow, zoom) / scale;
  const centered = { x: pan.x * ratio, y: pan.y * ratio };
  const bounds = graphNodeBounds(positions);
  const expected = clampGraphPan({ viewport: narrow, pan: centered, zoom, bounds });
  assert.notDeepEqual(expected, centered, "clamp가 실제로 개입하는 상황");
  assert.ok(Math.abs(next.x - expected.x) < 1e-6 && Math.abs(next.y - expected.y) < 1e-6);
});

test("노드가 없으면 화면 중심의 그래프 좌표만 유지한다", () => {
  const zoom = 1.5;
  const pan = { x: 40, y: 25 };
  const narrow = { width: 600, height: 500 };
  const next = resizeGraphPan({ previousViewport: wide, viewport: narrow, pan, zoom, positions: [] });
  const before = centerGraphPoint(wide, pan, zoom);
  const after = centerGraphPoint(narrow, next, zoom);
  assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6);
});
