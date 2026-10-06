import assert from "node:assert/strict";
import test from "node:test";

const { decideWakeStep, isReadyStatus } = await import("../src/views/login/model/wakeStep.ts");

test("절전 중이면 안내를 띄우고 기동을 다시 요청한다", () => {
  assert.equal(decideWakeStep("asleep", false), "request-wake");
  assert.equal(decideWakeStep("asleep", true), "request-wake");
});

test("기동·절전 진행 중이면 안내를 띄우고 계속 확인한다", () => {
  assert.equal(decideWakeStep("waking", false), "wait");
  assert.equal(decideWakeStep("sleeping", false), "wait");
});

test("awake가 되면 안내 중일 때만 앱 응답을 확인한다", () => {
  assert.equal(decideWakeStep("awake", true), "probe");
  assert.equal(decideWakeStep("awake", false), "stop");
});

test("unknown은 처음이면 기능 꺼짐으로 종료하고, 안내 중이면 계속 확인한다", () => {
  assert.equal(decideWakeStep("unknown", false), "stop");
  assert.equal(decideWakeStep("unknown", true), "wait");
});

test("앱 준비 확인은 서버가 응답만 하면(401 포함) 준비로 본다", () => {
  assert.equal(isReadyStatus(200), true);
  assert.equal(isReadyStatus(401), true);
  assert.equal(isReadyStatus(502), false);
  assert.equal(isReadyStatus(503), false);
});
