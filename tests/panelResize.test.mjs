import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PANEL_BASE_WIDTH,
  AGENT_PANEL_LIMITS,
  DEFAULT_AGENT_PANEL_STATE,
  DEFAULT_SIDEBAR_STATE,
  PANEL_KEYBOARD_STEP,
  SIDEBAR_BASE_WIDTH,
  SIDEBAR_LIMITS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  clampPanelWidth,
  collapsePanel,
  createPanelLimits,
  expandPanel,
  getAgentPanelMaxWidth,
  getSidebarVisibleWidth,
  normalizePanelState,
  parseStoredPanelState,
  resolvePanelDrag,
  resolvePanelKeyStep
} from "../src/widgets/workspace/lib/panelResize.ts";

// --- 왼쪽 사이드바 (기본 300px) ---

test("폭 상수는 기본 300px 기준 60%·140%와 54px 레일이다", () => {
  assert.equal(SIDEBAR_BASE_WIDTH, 300);
  assert.equal(SIDEBAR_MIN_WIDTH, 180);
  assert.equal(SIDEBAR_MAX_WIDTH, 420);
  assert.deepEqual(SIDEBAR_LIMITS, { min: 180, max: 420 });
  assert.equal(SIDEBAR_RAIL_WIDTH, 54);
  assert.equal(PANEL_KEYBOARD_STEP, 16);
  assert.deepEqual(DEFAULT_SIDEBAR_STATE, { isCollapsed: false, width: 300 });
});

test("드래그 폭이 최소~최대 사이면 그 폭으로 펼친다", () => {
  assert.deepEqual(resolvePanelDrag(250, DEFAULT_SIDEBAR_STATE, SIDEBAR_LIMITS), { isCollapsed: false, width: 250 });
  assert.deepEqual(resolvePanelDrag(180, DEFAULT_SIDEBAR_STATE, SIDEBAR_LIMITS), { isCollapsed: false, width: 180 });
  assert.deepEqual(resolvePanelDrag(260.6, DEFAULT_SIDEBAR_STATE, SIDEBAR_LIMITS), { isCollapsed: false, width: 261 });
});

test("드래그 폭이 최대를 넘으면 420px로 막는다", () => {
  assert.deepEqual(resolvePanelDrag(900, DEFAULT_SIDEBAR_STATE, SIDEBAR_LIMITS), { isCollapsed: false, width: 420 });
});

test("드래그 폭이 180px 미만이면 접는다(width는 드래그 전 값으로 남지만 펼칠 때 쓰지 않는다)", () => {
  assert.deepEqual(resolvePanelDrag(179, { isCollapsed: false, width: 360 }, SIDEBAR_LIMITS), { isCollapsed: true, width: 360 });
  assert.deepEqual(resolvePanelDrag(-40, DEFAULT_SIDEBAR_STATE, SIDEBAR_LIMITS), { isCollapsed: true, width: 300 });
});

test("접힌 레일을 180px 이상으로 끌면 드래그 위치 폭으로 다시 펼친다", () => {
  const collapsed = { isCollapsed: true, width: 360 };
  assert.deepEqual(resolvePanelDrag(120, collapsed, SIDEBAR_LIMITS), collapsed);
  assert.deepEqual(resolvePanelDrag(200, collapsed, SIDEBAR_LIMITS), { isCollapsed: false, width: 200 });
});

test("숫자가 아닌 드래그 폭은 이전 상태를 유지한다", () => {
  assert.equal(resolvePanelDrag(Number.NaN, DEFAULT_SIDEBAR_STATE, SIDEBAR_LIMITS), DEFAULT_SIDEBAR_STATE);
});

test("화면에 보이는 폭은 접히면 레일 폭, 펼치면 저장 폭이다", () => {
  assert.equal(getSidebarVisibleWidth({ isCollapsed: true, width: 360 }), 54);
  assert.equal(getSidebarVisibleWidth({ isCollapsed: false, width: 360 }), 360);
});

test("펼치기 버튼은 접기 전 폭과 상관없이 항상 기본 폭(100%)으로 펼친다", () => {
  assert.deepEqual(expandPanel(SIDEBAR_BASE_WIDTH), { isCollapsed: false, width: 300 });
  assert.deepEqual(expandPanel(SIDEBAR_BASE_WIDTH), DEFAULT_SIDEBAR_STATE);
  // 넓게 쓰다 접어도, 좁게 쓰다 접어도, 접힌 채 저장돼 복원돼도 펼치면 300px이다.
  for (const width of [420, 200, 360]) {
    const collapsed = collapsePanel({ isCollapsed: false, width });
    assert.equal(collapsed.isCollapsed, true);
    assert.deepEqual(expandPanel(SIDEBAR_BASE_WIDTH), { isCollapsed: false, width: 300 });
  }
  assert.deepEqual(expandPanel(AGENT_PANEL_BASE_WIDTH), { isCollapsed: false, width: 360 });
});

test("키보드 한 칸은 16px씩 조절하고 180px 미만이면 접는다", () => {
  assert.deepEqual(resolvePanelKeyStep(DEFAULT_SIDEBAR_STATE, 1, SIDEBAR_LIMITS), { isCollapsed: false, width: 316 });
  assert.deepEqual(resolvePanelKeyStep(DEFAULT_SIDEBAR_STATE, -1, SIDEBAR_LIMITS), { isCollapsed: false, width: 284 });
  assert.deepEqual(resolvePanelKeyStep({ isCollapsed: false, width: 416 }, 1, SIDEBAR_LIMITS), { isCollapsed: false, width: 420 });
  assert.deepEqual(resolvePanelKeyStep({ isCollapsed: false, width: 190 }, -1, SIDEBAR_LIMITS), { isCollapsed: true, width: 190 });
});

test("접힌 상태에서 넓히기 키는 최소 폭으로 펼치고 좁히기 키는 그대로 둔다", () => {
  const collapsed = { isCollapsed: true, width: 360 };
  assert.deepEqual(resolvePanelKeyStep(collapsed, 1, SIDEBAR_LIMITS), { isCollapsed: false, width: 180 });
  assert.equal(resolvePanelKeyStep(collapsed, -1, SIDEBAR_LIMITS), collapsed);
});

test("저장 값은 범위 안으로 정규화하고 잘못된 값은 기본값을 쓴다", () => {
  const normalize = (value) => normalizePanelState(value, SIDEBAR_LIMITS, DEFAULT_SIDEBAR_STATE);
  assert.deepEqual(normalize({ isCollapsed: true, width: 360 }), { isCollapsed: true, width: 360 });
  assert.deepEqual(normalize({ isCollapsed: false, width: 9999 }), { isCollapsed: false, width: 420 });
  assert.deepEqual(normalize({ isCollapsed: false, width: 10 }), { isCollapsed: false, width: 180 });
  assert.deepEqual(normalize({ isCollapsed: "yes", width: "wide" }), DEFAULT_SIDEBAR_STATE);
  assert.deepEqual(normalize(null), DEFAULT_SIDEBAR_STATE);
  assert.deepEqual(normalize([1, 2]), DEFAULT_SIDEBAR_STATE);
});

test("저장 문자열을 읽지 못하면 기본값을 쓴다", () => {
  const parse = (raw) => parseStoredPanelState(raw, SIDEBAR_LIMITS, DEFAULT_SIDEBAR_STATE);
  assert.deepEqual(parse(null), DEFAULT_SIDEBAR_STATE);
  assert.deepEqual(parse("{broken"), DEFAULT_SIDEBAR_STATE);
  assert.deepEqual(parse('{"isCollapsed":true,"width":240}'), { isCollapsed: true, width: 240 });
});

// --- 오른쪽 채팅 패널 (기본 360px) ---

test("채팅 패널은 기본 360px 기준 60%(216px)·140%(504px)다", () => {
  assert.equal(AGENT_PANEL_BASE_WIDTH, 360);
  assert.deepEqual(AGENT_PANEL_LIMITS, { min: 216, max: 504 });
  assert.deepEqual(createPanelLimits(360), AGENT_PANEL_LIMITS);
  assert.deepEqual(DEFAULT_AGENT_PANEL_STATE, { isCollapsed: false, width: 360 });
});

test("채팅 패널 드래그는 216px 미만이면 접힌다", () => {
  const base = { isCollapsed: false, width: 400 };
  assert.deepEqual(resolvePanelDrag(216, base, AGENT_PANEL_LIMITS), { isCollapsed: false, width: 216 });
  assert.equal(resolvePanelDrag(215, base, AGENT_PANEL_LIMITS).isCollapsed, true);
  assert.deepEqual(resolvePanelDrag(800, base, AGENT_PANEL_LIMITS), { isCollapsed: false, width: 504 });
});

test("채팅 패널 최대 폭은 콘텐츠 영역 480px을 남기고 504px·216px 사이로 맞춘다", () => {
  assert.equal(getAgentPanelMaxWidth(1600, 300), 504);
  assert.equal(getAgentPanelMaxWidth(1200, 300), 420);
  assert.equal(getAgentPanelMaxWidth(900, 300), 216);
  assert.equal(getAgentPanelMaxWidth(1200, 54), 504);
});

test("창이 좁아 최대 폭이 줄면 그 안으로 맞추되 최소 폭은 지킨다", () => {
  const limits = { min: 216, max: getAgentPanelMaxWidth(1200, 300) };
  assert.equal(clampPanelWidth(504, limits), 420);
  assert.equal(clampPanelWidth(300, limits), 300);
  assert.equal(clampPanelWidth(100, limits), 216);
});

