import assert from "node:assert/strict";
import test from "node:test";
import { createOverlayHistory, getOverlayDepth } from "../src/shared/lib/overlayHistory.ts";

// history.back()과 타이머가 끝나는 순서를 테스트가 정하는 가짜 창. 브라우저처럼 back()은 나중에 끝난다.
function createFakeWindow() {
  let entries = [{ base: true }];
  let index = 0;
  let timers = new Map();
  let nextTimerId = 1;
  let traversals = [];
  let listeners = [];
  const win = {
    location: { href: "http://test/home" },
    history: {
      get state() { return entries[index]; },
      pushState(state) {
        entries = [...entries.slice(0, index + 1), state];
        index += 1;
      },
      back() { traversals = [...traversals, -1]; },
      forward() { traversals = [...traversals, 1]; }
    },
    addEventListener(type, listener) { if (type === "popstate") listeners = [...listeners, listener]; },
    removeEventListener(type, listener) { if (type === "popstate") listeners = listeners.filter((item) => item !== listener); },
    setTimeout(run) {
      const id = nextTimerId++;
      timers = new Map([...timers, [id, run]]);
      return id;
    },
    clearTimeout(id) { timers = new Map([...timers].filter(([key]) => key !== id)); }
  };
  const runTimers = () => {
    while (timers.size > 0) {
      const ready = [...timers.values()];
      timers = new Map();
      ready.forEach((run) => run());
    }
  };
  const finishTraversals = () => {
    while (traversals.length > 0) {
      const [delta, ...rest] = traversals;
      traversals = rest;
      index = Math.min(Math.max(index + delta, 0), entries.length - 1);
      const event = { state: entries[index] };
      listeners.forEach((listener) => listener(event));
    }
  };
  /** 지금까지 쌓인 일을 모두 끝낸다. */
  const settle = () => {
    for (let round = 0; round < 10; round += 1) {
      runTimers();
      finishTraversals();
    }
  };
  return {
    win,
    runTimers,
    finishTraversals,
    settle,
    depth: () => getOverlayDepth(entries[index]),
    entryCount: () => entries.length,
    replaceWithoutMarker: () => { entries = entries.map((entry, position) => (position === index ? { replaced: true } : entry)); }
  };
}

function setup() {
  const fake = createFakeWindow();
  const overlays = createOverlayHistory(fake.win);
  const open = () => {
    const overlay = { dismissCount: 0, close: () => {} };
    overlay.close = overlays.open(() => { overlay.dismissCount += 1; });
    return overlay;
  };
  return { ...fake, open };
}

test("back()이 타이머보다 늦게 끝나도 새 패널은 표식이 빠진 뒤에 쌓여 닫히지 않는다", () => {
  const { open, runTimers, finishTraversals, settle, depth, entryCount } = setup();
  const sidebar = open();
  settle();
  assert.equal(depth(), 1);

  sidebar.close();
  const panel = open();
  // 사이드바의 back()이 끝나기 전에 패널 타이머가 먼저 돈다.
  runTimers();
  assert.equal(entryCount(), 2, "아직 표식을 쌓지 않는다");
  finishTraversals();
  settle();

  assert.equal(panel.dismissCount, 0);
  assert.equal(depth(), 1, "패널 표식은 기본 항목 바로 위다");
  assert.equal(entryCount(), 2, "표식이 쌓여 남지 않는다");
});

test("back()이 타이머보다 먼저 끝나도 결과가 같다", () => {
  const { open, finishTraversals, settle, depth, entryCount } = setup();
  const sidebar = open();
  settle();

  sidebar.close();
  const panel = open();
  finishTraversals();
  settle();

  assert.equal(panel.dismissCount, 0);
  assert.equal(depth(), 1);
  assert.equal(entryCount(), 2);
});

test("전환한 패널도 뒤로 가기 한 번으로 닫히고 기본 항목으로 돌아간다", () => {
  const { win, open, runTimers, settle, depth } = setup();
  const sidebar = open();
  settle();
  sidebar.close();
  const panel = open();
  runTimers();
  settle();

  win.history.back();
  settle();
  assert.equal(panel.dismissCount, 1);
  assert.equal(depth(), 0);

  // 뒤로 가기로 닫힌 뒤 정리할 때 back()을 또 부르지 않는다.
  panel.close();
  settle();
  assert.equal(depth(), 0);
});

test("닫기 버튼으로 닫으면 표식을 되돌린다", () => {
  const { open, settle, depth } = setup();
  const panel = open();
  settle();
  assert.equal(depth(), 1);

  panel.close();
  settle();
  assert.equal(depth(), 0);
  assert.equal(panel.dismissCount, 0);
});

test("표식을 쌓기 전에 닫으면 history를 건드리지 않는다", () => {
  const { open, settle, entryCount, depth } = setup();
  open().close();
  settle();
  assert.equal(entryCount(), 1);
  assert.equal(depth(), 0);
});

test("back()을 기다리는 동안 닫힌 패널은 표식을 쌓지 않는다", () => {
  const { open, runTimers, settle, depth, entryCount } = setup();
  const sidebar = open();
  settle();
  sidebar.close();
  const panel = open();
  runTimers();
  panel.close();
  settle();
  assert.equal(depth(), 0);
  assert.equal(entryCount(), 2, "되돌린 표식만 앞으로 가기 항목으로 남는다");
});

test("빠르게 열고 닫기를 반복해도 표식이 쌓이지 않고 마지막 패널만 남는다", () => {
  const { open, runTimers, settle, depth, entryCount } = setup();
  let current = open();
  settle();
  for (let round = 0; round < 5; round += 1) {
    current.close();
    current = open();
    runTimers();
  }
  settle();
  assert.equal(current.dismissCount, 0);
  assert.equal(depth(), 1);
  assert.equal(entryCount(), 2);

  current.close();
  settle();
  assert.equal(depth(), 0);
});

test("앞으로 가기로 남은 표식에 돌아와도 열린 패널을 닫지 않고, 그 위에서 연 패널은 뒤로 가기로 닫힌다", () => {
  const { win, open, settle, depth } = setup();
  const sidebar = open();
  settle();
  win.history.back();
  settle();
  assert.equal(sidebar.dismissCount, 1);
  sidebar.close();

  win.history.forward();
  settle();
  assert.equal(depth(), 1);
  assert.equal(sidebar.dismissCount, 1);

  const panel = open();
  settle();
  assert.equal(depth(), 2);
  win.history.back();
  settle();
  assert.equal(panel.dismissCount, 1);
});

test("스트릭트 모드의 이중 실행은 표식을 하나만 쌓는다", () => {
  const { open, settle, depth, entryCount } = setup();
  open().close();
  const panel = open();
  settle();
  assert.equal(depth(), 1);
  assert.equal(entryCount(), 2);
  assert.equal(panel.dismissCount, 0);
});

test("겹침 전환 중 스트릭트 모드 이중 실행도 표식을 하나만 쌓는다", () => {
  const { open, runTimers, settle, depth, entryCount } = setup();
  const sidebar = open();
  settle();
  sidebar.close();
  open().close();
  const panel = open();
  runTimers();
  settle();
  assert.equal(panel.dismissCount, 0);
  assert.equal(depth(), 1);
  assert.equal(entryCount(), 2);
});

test("겹친 두 패널 중 위 패널만 뒤로 가기로 닫힌다", () => {
  const { win, open, settle, depth } = setup();
  const panel = open();
  settle();
  const sidebar = open();
  settle();
  assert.equal(depth(), 2);

  win.history.back();
  settle();
  assert.equal(sidebar.dismissCount, 1);
  assert.equal(panel.dismissCount, 0);
  assert.equal(depth(), 1);
});

test("겹친 두 패널을 함께 닫으면 위부터 차례로 표식을 되돌린다", () => {
  const { open, settle, depth } = setup();
  const panel = open();
  settle();
  const sidebar = open();
  settle();

  sidebar.close();
  panel.close();
  settle();
  assert.equal(depth(), 0);
});

test("이동으로 표식이 대체됐으면 되돌리지 않는다", () => {
  const { open, settle, replaceWithoutMarker, entryCount } = setup();
  const panel = open();
  settle();
  replaceWithoutMarker();
  panel.close();
  settle();
  assert.equal(entryCount(), 2);
  assert.equal(panel.dismissCount, 0);
});
