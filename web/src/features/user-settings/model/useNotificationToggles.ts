"use client";

import { useEffect, useState } from "react";
import { useUserPreferences, type UserPreferences } from "@/entities/user";
import { setNotificationSelection } from "./notificationSelection";
import { isNotificationControlEnabled } from "@/entities/user/model/preferences";

export type NotificationKey = keyof UserPreferences["notifications"];

type BrowserPermission = NotificationPermission | "unsupported";
/** 브라우저 알림이 꺼짐으로 보이는 이유. 문구는 화면(NotificationsPanel)이 언어에 맞춰 만든다. */
export type BrowserNotificationIssue = "unsupported" | "denied";

function readBrowserPermission(): BrowserPermission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function browserPermissionIssue(permission: BrowserPermission): BrowserNotificationIssue | null {
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "denied";
  return null;
}

/**
 * 알림 설정 토글 (설정 모달 알림 패널).
 * 값은 사용자 설정(preferences.notifications)이고, 브라우저 알림은 켤 때 권한 승인이 선행돼야 한다.
 */
export function useNotificationToggles() {
  const { preferences, updatePreferences } = useUserPreferences();
  const notifications = preferences.notifications;
  const notificationControls = preferences.notificationControls;
  // 마운트 전(SSR)에는 권한을 모르므로 null. 설정이 켜져 있어도 권한이 granted가 아니면 꺼짐으로 표시한다.
  const [browserPermission, setBrowserPermission] = useState<BrowserPermission | null>(null);
  const [browserIssue, setBrowserIssue] = useState<BrowserNotificationIssue | null>(null);

  useEffect(() => {
    const permission = readBrowserPermission();
    setBrowserPermission(permission);
    // 켜 두었는데 권한이 회수됐거나 미지원이면 꺼짐으로 보이는 이유를 알려 준다.
    if (notifications.browser) setBrowserIssue(browserPermissionIssue(permission));
    // 마운트 시점의 권한만 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkedValues: UserPreferences["notifications"] = {
    ...notifications,
    browser: notifications.browser && browserPermission === "granted"
  };

  async function setNotifications(keys: readonly NotificationKey[], nextValue: boolean) {
    let browserAllowed = true;
    // 브라우저 알림은 켤 때 권한 승인이 선행돼야 한다.
    if (keys.includes("browser")) {
      setBrowserIssue(null);
      if (nextValue) {
        const current = readBrowserPermission();
        const permission = current === "default" ? await Notification.requestPermission() : current;
        setBrowserPermission(permission);
        if (permission !== "granted") {
          // 권한 요청 창을 닫아 default로 남은 경우도 차단 안내를 보여 준다.
          setBrowserIssue(browserPermissionIssue(permission) ?? "denied");
          browserAllowed = false;
        }
      }
    }
    updatePreferences((current) => ({
      ...current,
      notifications: setNotificationSelection(current.notifications, keys, nextValue, browserAllowed)
    }));
  }

  async function toggleNotification(key: NotificationKey) {
    if (!isNotificationControlEnabled(key, notificationControls)) return;
    await setNotifications([key], !checkedValues[key]);
  }

  function setAllNotificationsEnabled(enabled: boolean) {
    updatePreferences((current) => ({ ...current, notificationControls: { ...current.notificationControls, enabled } }));
  }

  function setGroupNotificationsEnabled(group: string, enabled: boolean) {
    if (!notificationControls.enabled) return;
    updatePreferences((current) => ({
      ...current,
      notificationControls: { ...current.notificationControls, groups: { ...current.notificationControls.groups, [group]: enabled } }
    }));
  }

  return { checkedValues, browserIssue, toggleNotification, setNotifications, notificationControls, setAllNotificationsEnabled, setGroupNotificationsEnabled };
}
