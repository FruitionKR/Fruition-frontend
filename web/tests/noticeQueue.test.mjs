import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueNotice,
  selectEvictedNoticeIds
} from "../src/features/document-notifications/model/noticeQueue.ts";

const action = { label: "실행", onAction() {} };
const options = { max: 2, removeImmediately: false };

test("2개 이하이면 밀어내지 않는다", () => {
  assert.deepEqual(selectEvictedNoticeIds([{ id: "a" }, { id: "b" }], 2), []);
});

test("3번째 카드가 오면 가장 오래된 카드를 퇴장 표시한다", () => {
  const next = enqueueNotice([{ id: "a" }, { id: "b" }], { id: "c" }, options);

  assert.deepEqual(next.map((notice) => [notice.id, Boolean(notice.leaving)]), [
    ["a", true],
    ["b", false],
    ["c", false]
  ]);
});

test("퇴장 중인 카드는 개수에 세지 않는다", () => {
  const current = [{ id: "a", leaving: true }, { id: "b" }];

  assert.deepEqual(selectEvictedNoticeIds([...current, { id: "c" }], 2), []);
});

test("action 카드는 남기고 가장 오래된 일반 카드부터 밀어낸다", () => {
  const notices = [{ id: "a", action }, { id: "b" }, { id: "c" }];

  assert.deepEqual(selectEvictedNoticeIds(notices, 2), ["b"]);
});

test("보이는 카드가 모두 action 카드면 가장 오래된 action 카드를 밀어낸다", () => {
  const notices = [{ id: "a", action }, { id: "b", action }, { id: "c" }];

  assert.deepEqual(selectEvictedNoticeIds(notices, 2), ["a"]);
});

test("새 카드는 action이 없어도 밀어내지 않는다", () => {
  const notices = [{ id: "a", action }, { id: "b", action }, { id: "c" }];

  assert.ok(!selectEvictedNoticeIds(notices, 2).includes("c"));
});

test("removeImmediately면 넘친 카드를 바로 뺀다 (reduce-motion)", () => {
  const next = enqueueNotice([{ id: "a" }, { id: "b" }], { id: "c" }, { max: 2, removeImmediately: true });

  assert.deepEqual(next.map((notice) => notice.id), ["b", "c"]);
});

test("입력 배열을 변경하지 않는다", () => {
  const current = [{ id: "a" }, { id: "b" }];
  enqueueNotice(current, { id: "c" }, options);

  assert.deepEqual(current, [{ id: "a" }, { id: "b" }]);
});
