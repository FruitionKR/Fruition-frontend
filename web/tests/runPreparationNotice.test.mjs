import assert from "node:assert/strict";
import test from "node:test";
import { startRunPreparationNotice, AI_PREPARATION_NOTICE_DELAY_MS } from "../src/shared/lib/runPreparationNotice.ts";

test("접수된 요청이 첫 진행을 기다릴 때만 준비 안내를 표시하고 진행 때 해제한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [];
  const stop = startRunPreparationNotice((value) => notices.push(value));
  t.mock.timers.tick(AI_PREPARATION_NOTICE_DELAY_MS - 1);
  assert.deepEqual(notices, []);
  t.mock.timers.tick(1);
  assert.deepEqual(notices, [true]);
  stop();
  stop();
  t.mock.timers.tick(10000);
  assert.deepEqual(notices, [true, false]);
});

test("빠른 완료·실패·진행은 뒤늦은 준비 안내를 만들지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [];
  const stop = startRunPreparationNotice((value) => notices.push(value));
  stop();
  t.mock.timers.tick(10000);
  assert.deepEqual(notices, []);
});

test("취소하면 준비 안내와 타이머를 정리한다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const notices = [];
  startRunPreparationNotice((value) => notices.push(value), controller.signal);
  t.mock.timers.tick(AI_PREPARATION_NOTICE_DELAY_MS);
  controller.abort();
  t.mock.timers.tick(10000);
  assert.deepEqual(notices, [true, false]);
  startRunPreparationNotice((value) => notices.push(value), controller.signal);
  t.mock.timers.tick(10000);
  assert.deepEqual(notices, [true, false]);
});
