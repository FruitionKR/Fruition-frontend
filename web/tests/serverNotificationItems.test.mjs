import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const {
  buildServerNotifications,
  parseServerNotificationId,
  toServerNotificationId
} = await import("../src/widgets/notifications-view/lib/serverNotificationItems.ts");
const { isNotificationUnread, countUnreadNotifications } = await import("../src/widgets/notifications-view/lib/notificationFeed.ts");

const notification = (overrides) => ({
  id: "n1",
  type: "edit_conflict_registered",
  payload: { document_name: "할 일.md", author_user_id: "user_jihyun" },
  read: false,
  created_at: "2026-10-09T01:00:00Z",
  ...overrides
});

test("서버 알림을 워크스페이스 알림 항목으로 바꾸고 최신순으로 정렬한다", () => {
  const items = buildServerNotifications([
    notification({}),
    notification({ id: "n2", type: "edit_conflict_resolved", payload: { choice: "merged" }, read: true, created_at: "2026-10-09T02:00:00Z" }),
    notification({ id: "n3", created_at: "not-a-date" })
  ]);
  assert.deepEqual(items.map((item) => item.id), ["server:n2", "server:n1"]);
  assert.equal(items[0].category, "workspace");
  assert.equal(items[0].title, "편집 충돌 해결");
  assert.equal(items[0].tone, "success");
  assert.equal(items[0].serverRead, true);
  assert.equal(items[1].title, "편집 충돌 등록");
  assert.equal(items[1].tone, "failure");
  assert.match(items[1].description, /「할 일.md」에 user_jihyun님의 편집 충돌/);
  assert.deepEqual(items[1].details, [items[1].description]);
  assert.equal(items[1].occurredAt, Date.parse("2026-10-09T01:00:00Z"));
});

test("서버 알림은 브라우저 읽음 기록이 아니라 서버 read 값으로 안 읽음을 판단한다", () => {
  const [unread] = buildServerNotifications([notification({})]);
  const [read] = buildServerNotifications([notification({ read: true })]);
  // 기준 시각이 알림보다 늦고 id도 읽음 목록에 있어도 서버가 안 읽음이면 안 읽음이다.
  const state = { lastReadAt: Date.parse("2026-12-01T00:00:00Z"), readIds: ["server:n1"] };
  assert.equal(isNotificationUnread(unread, state), true);
  assert.equal(isNotificationUnread(read, { lastReadAt: 0, readIds: [] }), false);
  // 서버 값이 없는 항목은 기존대로 브라우저 기록을 쓴다.
  assert.equal(isNotificationUnread({ id: "member:u2", occurredAt: 10 }, { lastReadAt: 5, readIds: [] }), true);
  assert.equal(countUnreadNotifications([unread, read, { id: "member:u2", occurredAt: 10 }], { lastReadAt: 5, readIds: [] }), 2);
});

test("알림 화면 id와 서버 알림 id를 서로 바꾼다", () => {
  assert.equal(toServerNotificationId("abc"), "server:abc");
  assert.equal(parseServerNotificationId("server:abc"), "abc");
  assert.equal(parseServerNotificationId("member:u2"), null);
  assert.equal(parseServerNotificationId("task:op1"), null);
});
