"use client";

import { useEffect, useState } from "react";
import { useUserPreferences, type UserPreferences } from "@/entities/user";

export type NotificationKey = keyof UserPreferences["notifications"];

const BROWSER_UNSUPPORTED_MESSAGE = "이 브라우저는 알림을 지원하지 않습니다.";
const BROWSER_DENIED_MESSAGE = "브라우저 알림 권한이 차단되어 있습니다. 주소창의 사이트 설정에서 허용해 주세요.";

type BrowserPermission = NotificationPermission | "unsupported";

function readBrowserPermission(): BrowserPermission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function browserPermissionMessage(permission: BrowserPermission) {
  if (permission === "unsupported") return BROWSER_UNSUPPORTED_MESSAGE;
  if (permission === "denied") return BROWSER_DENIED_MESSAGE;
  return null;
}

/**
 * 알림 설정 토글 (설정 모달 알림 패널·알림 화면 설정 탭 공용).
 * 값은 사용자 설정(preferences.notifications)이고, 브라우저 알림은 켤 때 권한 승인이 선행돼야 한다.
 */
export function useNotificationToggles() {
  const { preferences, updatePreferences } = useUserPreferences();
  const notifications = preferences.notifications;
  // 마운트 전(SSR)에는 권한을 모르므로 null. 설정이 켜져 있어도 권한이 granted가 아니면 꺼짐으로 표시한다.
  const [browserPermission, setBrowserPermission] = useState<BrowserPermission | null>(null);
  const [browserMessage, setBrowserMessage] = useState<string | null>(null);

  useEffect(() => {
    const permission = readBrowserPermission();
    setBrowserPermission(permission);
    // 켜 두었는데 권한이 회수됐거나 미지원이면 꺼짐으로 보이는 이유를 알려 준다.
    if (notifications.browser) setBrowserMessage(browserPermissionMessage(permission));
    // 마운트 시점의 권한만 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkedValues: UserPreferences["notifications"] = {
    ...notifications,
    browser: notifications.browser && browserPermission === "granted"
  };

  async function toggleNotification(key: NotificationKey) {
    const nextValue = !checkedValues[key];
    // 브라우저 알림은 켤 때 권한 승인이 선행돼야 한다.
    if (key === "browser") {
      setBrowserMessage(null);
      if (nextValue) {
        const current = readBrowserPermission();
        const permission = current === "default" ? await Notification.requestPermission() : current;
        setBrowserPermission(permission);
        if (permission !== "granted") {
          // 권한 요청 창을 닫아 default로 남은 경우도 차단 안내를 보여 준다.
          setBrowserMessage(browserPermissionMessage(permission) ?? BROWSER_DENIED_MESSAGE);
          return;
        }
      }
    }
    updatePreferences((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: nextValue }
    }));
  }

  return { checkedValues, browserMessage, toggleNotification };
}
