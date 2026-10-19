import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const {
  describeNotification,
  markRead,
  nextNotificationPage,
  selectUnseenNotifications,
  toNoticePayload
} = await import("../src/features/document-notifications/model/serverNotifications.ts");
const { fetchNotifications } = await import("../src/features/document-notifications/api/notifications.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

const notification = (id, overrides = {}) => ({
  id, type: "workspace_notice", payload: { document_name: "할 일.md" }, read: false, created_at: `2026-10-12T00:00:0${id.slice(-1)}Z`, ...overrides
});

test("서버 알림은 종류와 관계없이 일반 문구로 보여 주고 편집 충돌 전용 문구는 없다", () => {
  // 서버 자동 병합으로 편집 충돌 알림은 더 오지 않는다. 남아 있는 옛 알림도 일반 문구로 깨지지 않게 보여 준다.
  const legacy = describeNotification(notification("n1", { type: "edit_conflict_registered" }));
  assert.equal(legacy.title, "알림");
  assert.doesNotMatch(legacy.message, /편집 충돌|설정 > 문서 관리/);
  assert.equal(describeNotification(notification("n3", { type: "something_new", payload: {} })).message, "something_new 알림이 도착했습니다.");
  assert.equal(toNoticePayload(notification("n1")).kind, "info");
});

test("처음 보는 미읽음 알림만 오래된 순으로 고른다", () => {
  const list = [notification("n3"), notification("n2", { read: true }), notification("n1")];
  assert.deepEqual(selectUnseenNotifications(new Set(["n1"]), list).map((item) => item.id), ["n3"]);
  assert.deepEqual(selectUnseenNotifications(new Set(), list).map((item) => item.id), ["n1", "n3"]);
});

test("다음 페이지 커서는 마지막 항목의 created_at·id이고, 한 페이지가 안 차면 없다", () => {
  const list = [notification("n2"), notification("n1")];
  assert.deepEqual(nextNotificationPage(list, 2), { before: "2026-10-12T00:00:01Z", beforeId: "n1" });
  assert.equal(nextNotificationPage(list, 50), null);
  assert.equal(nextNotificationPage([], 50), null);
});

test("읽음 처리는 목록을 재조회 없이 갱신하고 이미 읽은 항목은 그대로 둔다", () => {
  const list = [notification("n1"), notification("n2", { read: true }), notification("n3")];
  assert.deepEqual(markRead(list, ["n1"]).map((item) => item.read), [true, true, false]);
  assert.deepEqual(markRead(list, null).map((item) => item.read), [true, true, true]);
  // 기존 객체는 바꾸지 않는다.
  assert.equal(list[0].read, false);
});

test("알림 목록 조회는 unread_only·limit·before·before_id를 query로 보낸다", async (t) => {
  const original = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null), setItem() {}, removeItem() {} }
  });
  t.after(() => { globalThis.window = original; });
  saveAccessToken("test-access");
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    return Response.json({ notifications: [notification("n1")] });
  });

  assert.equal((await fetchNotifications()).length, 1);
  await fetchNotifications({ unreadOnly: true, limit: 20, before: "2026-10-12T00:00:01Z", beforeId: "n1" });

  assert.deepEqual(paths, [
    "/api/workspaces/ws_test/notifications",
    "/api/workspaces/ws_test/notifications?unread_only=true&limit=20&before=2026-10-12T00%3A00%3A01Z&before_id=n1"
  ]);
});
