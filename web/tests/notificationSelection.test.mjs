import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { browserEnv, createResolver, fakeUserPreferences, render } from "./asyncHookShim.mjs";

registerHooks({ resolve: createResolver({ "@/entities/user": new URL("./asyncHookShim.mjs", import.meta.url).href }) });
const { NOTIFICATION_SETTINGS, DEFAULT_USER_PREFERENCES, DEFAULT_NOTIFICATION_PREFERENCES } = await import("../src/entities/user/model/preferences.ts");
const { notificationSelection, setNotificationSelection } = await import("../src/features/user-settings/model/notificationSelection.ts");
const { useNotificationToggles } = await import("../src/features/user-settings/model/useNotificationToggles.ts");
const allKeys = Object.keys(NOTIFICATION_SETTINGS);
const keysFor = (group) => allKeys.filter((key) => NOTIFICATION_SETTINGS[key].group === group);

test("전체 끄기·켜기는 모든 알림 종류에 적용하며 원래 설정 객체는 바꾸지 않는다", () => {
  const before = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const off = setNotificationSelection(before, allKeys, false);
  assert.equal(Object.values(off).every((value) => value === false), true);
  const on = setNotificationSelection(off, allKeys, true);
  assert.equal(Object.values(on).every((value) => value === true), true);
  assert.deepEqual(before, DEFAULT_NOTIFICATION_PREFERENCES);
});

test("그룹별 통합 설정은 다른 그룹의 개별 선택을 보존한다", () => {
  for (const group of new Set(Object.values(NOTIFICATION_SETTINGS).map((setting) => setting.group))) {
    const keys = keysFor(group);
    const next = setNotificationSelection(DEFAULT_NOTIFICATION_PREFERENCES, keys, false);
    for (const key of allKeys) assert.equal(next[key], keys.includes(key) ? false : DEFAULT_NOTIFICATION_PREFERENCES[key]);
  }
});

test("개별 알림 변경은 통합 상태의 모두 켜짐·일부 켜짐·모두 꺼짐에 즉시 반영된다", () => {
  const keys = keysFor("문서·PDF");
  const on = setNotificationSelection(DEFAULT_NOTIFICATION_PREFERENCES, keys, true);
  assert.equal(notificationSelection(on, keys).allEnabled, true);
  const mixed = { ...on, [keys[0]]: false };
  assert.equal(notificationSelection(mixed, keys).allEnabled, false);
  assert.equal(notificationSelection(mixed, keys).anyEnabled, true);
  const off = setNotificationSelection(mixed, keys, false);
  assert.equal(notificationSelection(off, keys).anyEnabled, false);
});

function setupHook(t, permission) {
  browserEnv(t);
  const originalNotification = globalThis.Notification;
  let requests = 0;
  if (permission !== "unsupported") {
    const notification = { permission, requestPermission: async () => { requests += 1; return permission === "default" ? "granted" : permission; } };
    globalThis.Notification = notification;
    window.Notification = notification;
  }
  t.after(() => { globalThis.Notification = originalNotification; });
  fakeUserPreferences.preferences = structuredClone(DEFAULT_USER_PREFERENCES);
  let updates = 0;
  fakeUserPreferences.updatePreferences = (update) => {
    updates += 1;
    fakeUserPreferences.preferences = update(fakeUserPreferences.preferences);
  };
  t.after(() => { delete fakeUserPreferences.updatePreferences; });
  const view = render(useNotificationToggles);
  t.after(view.unmount);
  view.rerender();
  return { view, requests: () => requests, updates: () => updates };
}

test("전체 끄기는 브라우저 권한을 요청하지 않고 한 번의 갱신으로 처리한다", async (t) => {
  const { view, requests, updates } = setupHook(t, "default");
  await view.result.setNotifications(allKeys, false);
  assert.equal(requests(), 0);
  assert.equal(updates(), 1);
  assert.equal(Object.values(fakeUserPreferences.preferences.notifications).every((value) => value === false), true);
});

test("전체 켜기에서 브라우저 권한이 차단돼도 다른 알림은 켜고 안내한다", async (t) => {
  const { view } = setupHook(t, "denied");
  await view.result.setNotifications(allKeys, true);
  view.rerender();
  assert.equal(view.result.checkedValues.browser, false);
  assert.match(view.result.browserMessage, /차단/);
  assert.equal(allKeys.filter((key) => key !== "browser").every((key) => view.result.checkedValues[key]), true);
});

test("브라우저 알림 미지원 환경에서도 나머지 통합 설정은 동작한다", async (t) => {
  const { view } = setupHook(t, "unsupported");
  await view.result.setNotifications(allKeys, true);
  view.rerender();
  assert.equal(view.result.checkedValues.browser, false);
  assert.match(view.result.browserMessage, /지원하지 않/);
  assert.equal(view.result.checkedValues.trashRestore, true);
});

test("브라우저 알림을 포함하지 않은 그룹은 권한 요청 없이 켠다", async (t) => {
  const { view, requests } = setupHook(t, "default");
  await view.result.setNotifications(keysFor("문서·PDF"), true);
  assert.equal(requests(), 0);
});

test("전체 켜기는 브라우저 권한을 한 번 요청하고 승인 결과를 반영한다", async (t) => {
  const { view, requests } = setupHook(t, "default");
  await view.result.setNotifications(allKeys, true);
  view.rerender();
  assert.equal(requests(), 1);
  assert.equal(Object.values(view.result.checkedValues).every(Boolean), true);
});

test("전체 스위치는 개별 선택·그룹 설정을 보존하고 꺼진 동안 하위 변경을 막는다", async (t) => {
  const { view, requests } = setupHook(t, "default");
  const original = structuredClone(fakeUserPreferences.preferences.notifications);
  view.result.setAllNotificationsEnabled(false);
  view.rerender();
  view.result.setGroupNotificationsEnabled("문서·PDF", false);
  await view.result.toggleNotification("trashRestore");
  assert.deepEqual(fakeUserPreferences.preferences.notifications, original);
  assert.equal(fakeUserPreferences.preferences.notificationControls.groups["문서·PDF"], true);
  view.result.setAllNotificationsEnabled(true);
  view.rerender();
  assert.deepEqual(view.result.checkedValues, original);
  assert.equal(requests(), 0, "상위 스위치는 기존 선택만 복원하므로 브라우저 권한을 새로 요청하지 않는다");
});

test("그룹 스위치를 껐다 켜면 개별 선택이 그대로 복원된다", async (t) => {
  const { view } = setupHook(t, "granted");
  await view.result.toggleNotification("pdfCompleted");
  view.rerender();
  const original = structuredClone(fakeUserPreferences.preferences.notifications);
  view.result.setGroupNotificationsEnabled("문서·PDF", false);
  view.rerender();
  await view.result.toggleNotification("trashRestore");
  assert.deepEqual(fakeUserPreferences.preferences.notifications, original);
  view.result.setGroupNotificationsEnabled("문서·PDF", true);
  view.rerender();
  assert.deepEqual(view.result.checkedValues, original);
  assert.equal(view.result.checkedValues.pdfCompleted, false);
  assert.equal(view.result.checkedValues.trashRestore, true);
});
