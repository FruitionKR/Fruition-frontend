import type { AppNotification } from "@/features/document-notifications/api/notifications";
import { describeNotification } from "@/features/document-notifications/model/serverNotifications";
import type { NotificationItem } from "./notificationFeed";

/** 서버 앱 안 알림의 알림 화면 id 접두어. 읽음 처리를 서버로 보낼 때 이 접두어로 구분한다. */
export const SERVER_NOTIFICATION_ID_PREFIX = "server:";

export function toServerNotificationId(notificationId: string): string {
  return `${SERVER_NOTIFICATION_ID_PREFIX}${notificationId}`;
}

/** 알림 화면 id가 서버 알림이면 서버 알림 id를, 아니면 null을 돌려준다. */
export function parseServerNotificationId(itemId: string): string | null {
  return itemId.startsWith(SERVER_NOTIFICATION_ID_PREFIX) ? itemId.slice(SERVER_NOTIFICATION_ID_PREFIX.length) : null;
}

/**
 * 서버 앱 안 알림을 워크스페이스 알림 항목으로 바꾼다. 읽음 상태는 서버가 가지므로 serverRead로 넘겨
 * 브라우저 읽음 기록 대신 쓰게 한다. 시각을 못 읽는 알림은 건너뛴다.
 */
export function buildServerNotifications(notifications: readonly AppNotification[]): NotificationItem[] {
  return notifications.flatMap((notification): NotificationItem[] => {
    const occurredAt = Date.parse(notification.created_at);
    if (Number.isNaN(occurredAt)) return [];
    const { title, message } = describeNotification(notification);
    return [{
      id: toServerNotificationId(notification.id),
      category: "workspace",
      title,
      description: message,
      occurredAt,
      changeCount: null,
      details: [message],
      tone: "success",
      serverRead: notification.read
    }];
  }).sort((a, b) => b.occurredAt - a.occurredAt);
}
