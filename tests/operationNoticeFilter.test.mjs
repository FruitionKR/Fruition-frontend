import assert from "node:assert/strict";
import test from "node:test";
import { createOperationNoticeFilter } from "../src/features/document-notifications/model/operationNoticeFilter.ts";

const enabled = { lint: true, restore: true };
const lintNotice = (id) => ({ kind: "completed", title: "Lint 완료", message: "", operation: { type: "lint", id } });

test("작업 알림이 아니면 항상 통과한다", () => {
  const filter = createOperationNoticeFilter();

  assert.equal(filter({ kind: "failed", title: "Lint 실패", message: "" }, { lint: false, restore: false }), true);
});

test("유형 설정이 꺼져 있으면 숨긴다", () => {
  const filter = createOperationNoticeFilter();

  assert.equal(filter(lintNotice("op-1"), { lint: false, restore: true }), false);
  assert.equal(filter({ kind: "completed", title: "", message: "", operation: { type: "restore" } }, { lint: true, restore: false }), false);
});

test("같은 operation id는 한 번만 통과한다", () => {
  const filter = createOperationNoticeFilter();

  assert.equal(filter(lintNotice("op-1"), enabled), true);
  assert.equal(filter(lintNotice("op-1"), enabled), false);
  assert.equal(filter(lintNotice("op-2"), enabled), true);
});

test("id가 없는 작업 알림은 거르지 않는다", () => {
  const filter = createOperationNoticeFilter();

  assert.equal(filter(lintNotice(undefined), enabled), true);
  assert.equal(filter(lintNotice(undefined), enabled), true);
});

test("설정이 꺼져 숨긴 알림은 id를 기억하지 않는다", () => {
  const filter = createOperationNoticeFilter();

  filter(lintNotice("op-1"), { lint: false, restore: true });
  assert.equal(filter(lintNotice("op-1"), enabled), true);
});

test("최근 id만 기억한다", () => {
  const filter = createOperationNoticeFilter(2);

  filter(lintNotice("op-1"), enabled);
  filter(lintNotice("op-2"), enabled);
  filter(lintNotice("op-3"), enabled);
  assert.equal(filter(lintNotice("op-1"), enabled), true);
  assert.equal(filter(lintNotice("op-3"), enabled), false);
});
