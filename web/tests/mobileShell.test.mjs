import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
import { computeKeyboardInset } from "../src/shared/lib/keyboardInset.ts";
import { createOverlayEntry, getOverlayDepth, isOverlayDismissedBy, resolveNavigationMode } from "../src/shared/lib/overlayHistory.ts";

const viewport = { layoutHeight: 800, visualHeight: 800, visualOffsetTop: 0, scale: 1 };

test("가상 키보드가 없으면 가리는 높이는 0이다", () => {
  assert.equal(computeKeyboardInset(viewport), 0);
});

test("주소창만큼의 작은 차이는 키보드로 보지 않는다", () => {
  assert.equal(computeKeyboardInset({ ...viewport, visualHeight: 720 }), 0);
});

test("iOS처럼 레이아웃은 그대로이고 보이는 영역만 줄면 그 차이가 키보드 높이다", () => {
  assert.equal(computeKeyboardInset({ ...viewport, visualHeight: 500 }), 300);
});

test("보이는 영역이 위로 밀렸으면 그만큼 뺀다", () => {
  assert.equal(computeKeyboardInset({ ...viewport, visualHeight: 500, visualOffsetTop: 100 }), 200);
});

test("핀치 확대 중에는 키보드로 판단하지 않는다", () => {
  assert.equal(computeKeyboardInset({ ...viewport, visualHeight: 400, scale: 2 }), 0);
});

test("표식이 없거나 잘못된 history 상태의 깊이는 0이다", () => {
  assert.equal(getOverlayDepth(null), 0);
  assert.equal(getOverlayDepth("x"), 0);
  assert.equal(getOverlayDepth({ __NA: true }), 0);
  assert.equal(getOverlayDepth({ fruitionOverlayDepth: "2" }), 0);
});

test("자기 표식 아래로 돌아오면 닫고, 위의 패널만 닫힌 경우에는 닫지 않는다", () => {
  assert.equal(getOverlayDepth(createOverlayEntry(2)), 2);
  assert.equal(isOverlayDismissedBy({ __NA: true }, 1), true);
  assert.equal(isOverlayDismissedBy(createOverlayEntry(1), 2), true);
  assert.equal(isOverlayDismissedBy(createOverlayEntry(1), 1), false);
});

test("표식 위에서의 이동은 표식을 대체하고, 그 외에는 요청한 방식을 따른다", () => {
  assert.equal(resolveNavigationMode(createOverlayEntry(1), "push"), "replace");
  assert.equal(resolveNavigationMode({ __NA: true }, "push"), "push");
  assert.equal(resolveNavigationMode(null, "replace"), "replace");
});

const { getTouchTooltipDelay, TOOLTIP_LONG_PRESS_MS } = await import("../src/shared/ui/Tooltip.logic.ts");
const { isGraphDoubleTap, GRAPH_DOUBLE_TAP_MS } = await import("../src/widgets/graph/lib/graphGeometry.ts");

test("터치 말풍선은 비활성 버튼·설명 버튼이면 바로, 나머지는 길게 눌러야 뜬다", () => {
  assert.equal(getTouchTooltipDelay({ isTriggerDisabled: true, showOnTap: false }), 0);
  assert.equal(getTouchTooltipDelay({ isTriggerDisabled: false, showOnTap: true }), 0);
  assert.equal(getTouchTooltipDelay({ isTriggerDisabled: false, showOnTap: false }), TOOLTIP_LONG_PRESS_MS);
});

test("같은 노드를 시간 안에 다시 탭해야 더블 탭이다", () => {
  const first = { nodeId: "a", at: 1000 };
  assert.equal(isGraphDoubleTap(null, first), false);
  assert.equal(isGraphDoubleTap(first, { nodeId: "a", at: 1000 + GRAPH_DOUBLE_TAP_MS }), true);
  assert.equal(isGraphDoubleTap(first, { nodeId: "a", at: 1001 + GRAPH_DOUBLE_TAP_MS }), false);
  assert.equal(isGraphDoubleTap(first, { nodeId: "b", at: 1100 }), false);
});
