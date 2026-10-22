import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { advance, browserEnv, createResolver, fakeUserPreferences, render } from "./asyncHookShim.mjs";

registerHooks({ resolve: createResolver({ "@/entities/user": new URL("./asyncHookShim.mjs", import.meta.url).href }) });
const { DEFAULT_USER_PREFERENCES } = await import("../src/entities/user/model/preferences.ts");
const { useOperationNotifications } = await import("../src/features/document-notifications/model/useOperationNotifications.ts");
const { subscribeNotices } = await import("../src/features/document-notifications/model/noticeBus.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");

function setup(t) {
  browserEnv(t);
  saveAccessToken("test-access");
  fakeUserPreferences.preferences = structuredClone(DEFAULT_USER_PREFERENCES);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = { requests: [], logs: [] };
  t.mock.method(globalThis, "fetch", async (path) => {
    const query = new URL(path, "http://test").searchParams;
    server.requests.push(Object.fromEntries(query));
    return Response.json({ logs: query.has("status") ? [] : server.logs, next_cursor: null });
  });
  const notices = [];
  const unsubscribe = subscribeNotices((notice) => notices.push(notice));
  t.after(unsubscribe);
  return { server, notices, preferences: fakeUserPreferences.preferences };
}

test("전체·그룹·종류 설정이 꺼지면 작업 알림 조회를 시작하지 않는다", async (t) => {
  const { server, preferences } = setup(t);
  for (const disable of [
    () => { preferences.notificationControls.enabled = false; },
    () => { preferences.notificationControls.enabled = true; preferences.notificationControls.groups.위키 = false; },
    () => { preferences.notificationControls.groups.위키 = true; Object.assign(preferences.notifications, { lint: false, lintFailed: false, restore: false, restoreFailed: false }); }
  ]) {
    disable();
    const view = render(useOperationNotifications);
    await advance(t, 30_000);
    view.unmount();
  }
  assert.equal(server.requests.length, 0);
});

test("실패 알림만 켜도 해당 유형만 조회하고 끄면 예약된 폴링을 해제한다", async (t) => {
  const { server, preferences } = setup(t);
  Object.assign(preferences.notifications, { lint: false, restore: false, restoreFailed: false });
  const view = render(useOperationNotifications);
  await advance(t, 0);
  assert.deepEqual(server.requests, [{ type: "lint" }, { type: "lint", status: "processing", size: "10" }]);
  preferences.notifications.lintFailed = false;
  view.rerender();
  await advance(t, 30_000);
  assert.equal(server.requests.length, 2);
  view.unmount();
});

test("다시 켜면 현재 종결 작업을 기준점으로 삼고 이후 완료만 알린다", async (t) => {
  const { server, notices, preferences } = setup(t);
  const view = render(useOperationNotifications);
  await advance(t, 0);
  preferences.notificationControls.enabled = false;
  view.rerender();
  server.logs = [{ operation_id: "while-off", operation_type: "lint", status: "succeeded" }];
  preferences.notificationControls.enabled = true;
  view.rerender();
  await advance(t, 0);
  assert.deepEqual(notices, []);
  server.logs.push({ operation_id: "after-on", operation_type: "restore", status: "succeeded" });
  await advance(t, 15_000);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].operation.id, "after-on");
  view.unmount();
});
