import type { NotificationKey, NotificationPreferences } from "@/entities/user/model/preferences";

export function notificationSelection(settings: NotificationPreferences, keys: readonly NotificationKey[]) {
  const enabledCount = keys.filter((key) => settings[key]).length;
  return { enabledCount, total: keys.length, anyEnabled: enabledCount > 0, allEnabled: keys.length > 0 && enabledCount === keys.length };
}

/** 한 번의 설정 갱신으로 적용한다. 브라우저 권한이 없으면 다른 항목만 켠다. */
export function setNotificationSelection(
  settings: NotificationPreferences,
  keys: readonly NotificationKey[],
  enabled: boolean,
  browserAllowed = true
): NotificationPreferences {
  return {
    ...settings,
    ...Object.fromEntries(keys.map((key) => [key, enabled && (key !== "browser" || browserAllowed)]))
  };
}
