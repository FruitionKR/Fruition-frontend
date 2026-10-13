import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOLTIP_GAP_PX,
  TOOLTIP_OPEN_DELAY_MS,
  TOOLTIP_WARM_WINDOW_MS,
  computeTooltipPosition,
  getTooltipOpenDelay
} from "../src/shared/ui/Tooltip.logic.ts";

const viewport = { width: 1280, height: 800 };
// 레일 버튼: 왼쪽 8px, 36px 정사각
const railButton = { top: 100, left: 8, width: 36, height: 36 };

test("처음 hover하면 150ms 뒤에 띄운다", () => {
  assert.equal(TOOLTIP_OPEN_DELAY_MS, 150);
  assert.equal(getTooltipOpenDelay({ now: 10_000, lastClosedAt: null, isAnyOpen: false }), 150);
});

test("다른 툴팁이 떠 있으면 지연 없이 바로 띄운다", () => {
  assert.equal(getTooltipOpenDelay({ now: 10_000, lastClosedAt: null, isAnyOpen: true }), 0);
});

test("마지막 툴팁이 닫힌 직후(warm-up 창 안)에는 바로 띄우고, 지나면 다시 지연한다", () => {
  const closedAt = 10_000;
  assert.equal(getTooltipOpenDelay({ now: closedAt + 120, lastClosedAt: closedAt, isAnyOpen: false }), 0);
  assert.equal(
    getTooltipOpenDelay({ now: closedAt + TOOLTIP_WARM_WINDOW_MS, lastClosedAt: closedAt, isAnyOpen: false }),
    TOOLTIP_OPEN_DELAY_MS
  );
});

test("오른쪽 배치는 버튼 오른쪽 8px, 세로 중앙에 둔다", () => {
  const position = computeTooltipPosition({
    anchor: railButton,
    size: { width: 80, height: 28 },
    viewport,
    placement: "right"
  });

  assert.equal(position.placement, "right");
  assert.equal(position.left, 8 + 36 + TOOLTIP_GAP_PX);
  assert.equal(position.top, 100 + 18 - 14);
  // 꼬리는 말풍선 세로 중앙(버튼 중앙)을 가리킨다.
  assert.equal(position.arrowOffset, 14);
});

test("화면 아래로 넘치면 위로 밀어 넣고 꼬리는 버튼 중앙을 계속 가리킨다", () => {
  const anchor = { top: 760, left: 8, width: 36, height: 28 };
  const position = computeTooltipPosition({ anchor, size: { width: 120, height: 48 }, viewport, placement: "right" });

  assert.equal(position.top, 800 - 8 - 48);
  assert.equal(position.arrowOffset, 774 - 744);
});

test("꼬리는 말풍선 모서리 밖으로 나가지 않는다", () => {
  const anchor = { top: 0, left: 8, width: 36, height: 8 };
  const position = computeTooltipPosition({ anchor, size: { width: 80, height: 40 }, viewport, placement: "right" });

  assert.equal(position.top, 8);
  assert.equal(position.arrowOffset, 10);
});

test("오른쪽으로 넘치면 왼쪽으로 뒤집는다", () => {
  const anchor = { top: 100, left: 1230, width: 36, height: 36 };
  const position = computeTooltipPosition({ anchor, size: { width: 120, height: 28 }, viewport, placement: "right" });

  assert.equal(position.placement, "left");
  assert.equal(position.left, 1230 - TOOLTIP_GAP_PX - 120);
});

test("위 배치가 넘치면 아래로 뒤집고 가로는 화면 안으로 맞춘다", () => {
  const anchor = { top: 4, left: 2, width: 36, height: 36 };
  const position = computeTooltipPosition({ anchor, size: { width: 100, height: 28 }, viewport, placement: "top" });

  assert.equal(position.placement, "bottom");
  assert.equal(position.top, 4 + 36 + TOOLTIP_GAP_PX);
  assert.equal(position.left, 8);
  assert.equal(position.arrowOffset, 20 - 8);
});
