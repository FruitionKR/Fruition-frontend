import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueNotice,
  NOTICE_MIN_VISIBLE_MS,
  planNoticeOverflow,
  promoteParkedNotices,
  reconcileNotices,
  selectAutoDismissIds,
  visibleNoticeSubjectIds
} from "../src/features/document-notifications/model/noticeQueue.ts";

const action = { label: "실행", onAction() {} };
const NOW = 100_000;
const options = { max: 2, now: NOW, removeImmediately: false };
const state = (notices) => notices.map((notice) => [notice.id, notice.leaving ? "leaving" : notice.parked ? "parked" : "shown"]);

test("2개 이하이면 아무것도 내리지 않는다", () => {
  assert.deepEqual(planNoticeOverflow([{ id: "a" }, { id: "b" }], { max: 2, now: NOW }), { evictIds: [], parkIds: [] });
});

test("충분히 보인 일반 카드는 3번째 카드가 오면 퇴장 표시한다", () => {
  const next = enqueueNotice([{ id: "a" }, { id: "b" }], { id: "c" }, options);

  assert.deepEqual(state(next), [["a", "leaving"], ["b", "shown"], ["c", "shown"]]);
});

test("퇴장 중·대기 중인 카드는 개수에 세지 않는다", () => {
  const current = [{ id: "a", leaving: true }, { id: "p", parked: true }, { id: "b" }];

  assert.deepEqual(planNoticeOverflow([...current, { id: "c" }], { max: 2, now: NOW }), { evictIds: [], parkIds: [] });
});

test("action 카드는 닫지 않고 충분히 보인 일반 카드부터 닫는다", () => {
  const notices = [{ id: "a", action }, { id: "b" }, { id: "c" }];

  assert.deepEqual(planNoticeOverflow(notices, { max: 2, now: NOW }), { evictIds: ["b"], parkIds: [] });
});

test("보이는 카드가 모두 action 카드면 가장 오래된 action 카드를 닫지 않고 대기열로 뺀다", () => {
  const next = enqueueNotice([{ id: "a", action }, { id: "b", action }], { id: "c" }, options);

  assert.deepEqual(state(next), [["a", "parked"], ["b", "shown"], ["c", "shown"]]);
});

test("방금 뜬 결과 카드는 새 제안 카드에 밀려 사라지지 않는다 (QA: 일괄 작업 결과가 30ms 만에 사라짐)", () => {
  // 제안 카드 둘이 떠 있는 동안 결과 카드가 온다.
  let notices = enqueueNotice([{ id: "a1", action, shownAt: 0 }, { id: "a2", action, shownAt: 0 }], { id: "result" }, options);
  assert.deepEqual(state(notices), [["a1", "parked"], ["a2", "shown"], ["result", "shown"]]);

  // 30ms 뒤 리마인드 제안 카드가 와도 결과 카드는 남고, 오래된 제안 카드가 대기열로 간다.
  notices = enqueueNotice(notices, { id: "a3", action }, { ...options, now: NOW + 30 });
  assert.deepEqual(state(notices), [["a1", "parked"], ["a2", "parked"], ["result", "shown"], ["a3", "shown"]]);
});

test("최소 표시 시간이 지난 결과 카드는 새 카드에 자리를 내준다", () => {
  const notices = [{ id: "a", action, shownAt: 0 }, { id: "result", shownAt: NOW }];
  const next = enqueueNotice(notices, { id: "a2", action }, { ...options, now: NOW + NOTICE_MIN_VISIBLE_MS });

  assert.deepEqual(state(next), [["a", "shown"], ["result", "leaving"], ["a2", "shown"]]);
});

test("새 카드는 action이 없어도 내리지 않는다", () => {
  const notices = [{ id: "a", action }, { id: "b", action }, { id: "c" }];
  const { evictIds, parkIds } = planNoticeOverflow(notices, { max: 2, now: NOW });

  assert.ok(![...evictIds, ...parkIds].includes("c"));
});

test("removeImmediately면 닫을 카드를 바로 뺀다 (reduce-motion)", () => {
  const next = enqueueNotice([{ id: "a" }, { id: "b" }], { id: "c" }, { ...options, removeImmediately: true });

  assert.deepEqual(next.map((notice) => notice.id), ["b", "c"]);
});

test("입력 배열을 변경하지 않는다", () => {
  const current = [{ id: "a" }, { id: "b" }];
  enqueueNotice(current, { id: "c" }, options);

  assert.deepEqual(current, [{ id: "a" }, { id: "b" }]);
});

test("자리가 나면 대기열의 카드를 들어온 순서대로 다시 보이고 표시 시각을 새로 잡는다", () => {
  const notices = [
    { id: "a", action, parked: true, shownAt: 0 },
    { id: "b", parked: true, shownAt: 0 },
    { id: "c", leaving: true },
    { id: "d" }
  ];
  const next = promoteParkedNotices(notices, { max: 2, now: NOW });

  assert.deepEqual(state(next), [["a", "shown"], ["b", "parked"], ["c", "leaving"], ["d", "shown"]]);
  assert.equal(next[0].shownAt, NOW);
});

test("자리가 없거나 대기 카드가 없으면 같은 배열을 돌려준다", () => {
  const full = [{ id: "a", parked: true }, { id: "b" }, { id: "c" }];
  const none = [{ id: "a" }];

  assert.equal(promoteParkedNotices(full, { max: 2, now: NOW }), full);
  assert.equal(promoteParkedNotices(none, { max: 2, now: NOW }), none);
});

test("대기 중인 카드의 문서도 제안 억제에 세고, 퇴장 중인 카드는 뺀다", () => {
  const notices = [
    { id: "a", action, subjectIds: ["doc1", "doc2"] },
    { id: "b", action, subjectIds: ["doc3"], leaving: true },
    { id: "p", action, subjectIds: ["doc4"], parked: true },
    { id: "c" }
  ];

  assert.deepEqual([...visibleNoticeSubjectIds(notices)].sort(), ["doc1", "doc2", "doc4"]);
});

test("자동 닫힘 대상은 퇴장 중·대기 중·action·이미 타이머가 있는 카드를 뺀다", () => {
  const notices = [
    { id: "a" },
    { id: "b", action },
    { id: "c", leaving: true },
    { id: "p", parked: true },
    { id: "d" }
  ];

  assert.deepEqual(selectAutoDismissIds(notices, new Set(["d"])), ["a"]);
});

test("타이머가 하나도 없으면(숨겼다 다시 보일 때) 남은 일반 카드 모두가 대상이다", () => {
  const notices = [{ id: "a" }, { id: "b", action }, { id: "c" }];

  assert.deepEqual(selectAutoDismissIds(notices, new Set()), ["a", "c"]);
});

test("reconcile이 null이면 카드를 내리고, 바뀐 내용만 새 객체로 만든다", () => {
  const same = { id: "same", message: "m", subjectIds: ["d1"] };
  const renamed = { id: "renamed", message: "old", subjectIds: ["d2", "d3"] };
  const gone = { id: "gone", message: "g", subjectIds: ["d4"] };
  const plain = { id: "plain", message: "p" };
  const updates = {
    same: { message: "m", subjectIds: ["d1"] },
    renamed: { message: "new", subjectIds: ["d2"] },
    gone: null
  };
  const next = reconcileNotices([same, renamed, gone, plain], (notice) => updates[notice.id], { removeImmediately: false });

  assert.equal(next[0], same);
  assert.deepEqual(next[1], { id: "renamed", message: "new", subjectIds: ["d2"] });
  assert.deepEqual(state(next), [["same", "shown"], ["renamed", "shown"], ["gone", "leaving"], ["plain", "shown"]]);
  assert.equal(next[3], plain);

  const immediate = reconcileNotices([gone], () => null, { removeImmediately: true });
  assert.deepEqual(immediate, []);
});

test("reconcile 결과가 모두 같으면 같은 배열을 돌려준다 (렌더 반복 방지)", () => {
  const notices = [{ id: "a", message: "m", subjectIds: ["d1"] }, { id: "b", leaving: true }];

  assert.equal(reconcileNotices(notices, () => ({ message: "m", subjectIds: ["d1"] }), { removeImmediately: false }), notices);
});
