import { DEFAULT_NOTIFICATION_CONTROLS, isNotificationControlEnabled, NOTIFICATION_SETTINGS, type NotificationControls, type NotificationKey, type NotificationPreferences } from "@/entities/user/model/preferences";
import type { NoticePayload } from "./noticeBus";

const keysByTitle = new Map<string, NotificationKey>(Object.entries(NOTIFICATION_SETTINGS).flatMap(
  ([key, setting]) => setting.titles.map((title) => [title, key as NotificationKey] as const)
));

/** 표시 문구가 동적인 작업 로그는 작업 유형으로, 나머지는 등록된 알림 제목으로 분류한다. */
export function noticeNotificationKey(notice: Pick<NoticePayload, "kind" | "title" | "operation" | "notificationKey">): NotificationKey {
  if (notice.notificationKey) return notice.notificationKey;
  if (notice.operation?.type === "lint") return notice.kind === "failed" ? "lintFailed" : "lint";
  if (notice.operation?.type === "restore") return notice.kind === "failed" ? "restoreFailed" : "restore";
  // 새 종류도 설정을 우회하지 않고 '기타 안내'로 제어한다.
  return keysByTitle.get(notice.title) ?? "other";
}

export function isNoticeEnabled(
  notice: Pick<NoticePayload, "kind" | "title" | "operation" | "notificationKey">,
  settings: NotificationPreferences,
  controls: NotificationControls = DEFAULT_NOTIFICATION_CONTROLS
): boolean {
  const key = noticeNotificationKey(notice);
  return isNotificationControlEnabled(key, controls) && settings[key];
}
