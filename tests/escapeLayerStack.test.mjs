import assert from "node:assert/strict";
import test from "node:test";
import { createEscapeLayerStack } from "../src/shared/lib/escapeLayerStack.ts";

function escapeEvent({ key = "Escape", isComposing = false, target = null } = {}) {
  const event = {
    key,
    isComposing,
    target,
    prevented: false,
    stopped: false,
    preventDefault() {
      event.prevented = true;
    },
    stopImmediatePropagation() {
      event.stopped = true;
    }
  };
  return event;
}

function layer(calls, name) {
  return { current: () => calls.push(name) };
}

test("Escape는 맨 위 레이어 하나만 닫고 전파를 막는다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  stack.push(layer(calls, "settings"));
  stack.push(layer(calls, "password"));

  const event = escapeEvent();
  assert.equal(stack.handleKeyDown(event), true);
  assert.deepEqual(calls, ["password"]);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});

test("제거된 레이어 다음에는 그 아래 레이어가 닫힌다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  stack.push(layer(calls, "settings"));
  const removeWizard = stack.push(layer(calls, "wizard"));
  const removeMenu = stack.push(layer(calls, "menu"));

  stack.handleKeyDown(escapeEvent());
  removeMenu();
  stack.handleKeyDown(escapeEvent());
  removeWizard();
  stack.handleKeyDown(escapeEvent());

  assert.deepEqual(calls, ["menu", "wizard", "settings"]);
  assert.equal(stack.size, 1);
});

test("핸들러 ref가 바뀌어도 등록 순서는 유지되고 최신 핸들러가 실행된다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  const lower = { current: () => calls.push("lower-old") };
  stack.push(lower);
  stack.push(layer(calls, "upper"));
  lower.current = () => calls.push("lower-new");

  stack.handleKeyDown(escapeEvent());
  assert.deepEqual(calls, ["upper"]);
});

test("IME 조합 중 Escape와 다른 키는 처리하지 않는다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  stack.push(layer(calls, "modal"));

  const composing = escapeEvent({ isComposing: true });
  assert.equal(stack.handleKeyDown(composing), false);
  assert.equal(stack.handleKeyDown(escapeEvent({ key: "Enter" })), false);
  assert.deepEqual(calls, []);
  assert.equal(composing.prevented, false);
  assert.equal(composing.stopped, false);
});

test("빈 스택은 Escape를 그대로 통과시킨다", () => {
  const stack = createEscapeLayerStack();
  const event = escapeEvent();
  assert.equal(stack.handleKeyDown(event), false);
  assert.equal(event.prevented, false);
  assert.equal(event.stopped, false);
});

test("fallback 레이어는 일반 레이어가 없을 때만 실행된다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  stack.push(layer(calls, "tree-selection"), "fallback");
  const removeConfirm = stack.push(layer(calls, "confirm"));
  // 나중에 등록된 fallback도 일반 레이어보다 우선하지 않는다.
  stack.push(layer(calls, "graph-selection"), "fallback");

  stack.handleKeyDown(escapeEvent());
  assert.deepEqual(calls, ["confirm"]);

  removeConfirm();
  stack.handleKeyDown(escapeEvent());
  assert.deepEqual(calls, ["confirm", "graph-selection"]);
});

test("입력 요소의 Escape는 fallback 레이어가 가로채지 않는다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  stack.push(layer(calls, "tree-selection"), "fallback");

  const inInput = escapeEvent({ target: { tagName: "INPUT" } });
  assert.equal(stack.handleKeyDown(inInput), false);
  assert.equal(inInput.stopped, false);
  assert.equal(stack.handleKeyDown(escapeEvent({ target: { tagName: "DIV", isContentEditable: true } })), false);
  assert.deepEqual(calls, []);

  assert.equal(stack.handleKeyDown(escapeEvent({ target: { tagName: "DIV" } })), true);
  assert.deepEqual(calls, ["tree-selection"]);
});

test("일반 레이어는 입력 요소 안의 Escape도 처리한다", () => {
  const stack = createEscapeLayerStack();
  const calls = [];
  stack.push(layer(calls, "modal"));
  assert.equal(stack.handleKeyDown(escapeEvent({ target: { tagName: "INPUT" } })), true);
  assert.deepEqual(calls, ["modal"]);
});
