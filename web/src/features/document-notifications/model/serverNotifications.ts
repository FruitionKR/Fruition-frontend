import type { AppNotification } from "../api/notifications";
import type { NoticePayload } from "./noticeBus";

/**
 * 서버 알림을 사람이 읽을 제목·본문으로 바꾼다. 알림 목록과 우하단 카드가 같은 문구를 쓴다.
 * 전용 문구가 있던 편집 충돌 알림은 서버 자동 병합으로 없어져 지금은 모든 종류를 일반 문구로 보여준다.
 */
export function describeNotification(notification: AppNotification): { title: string; message: string } {
  return { title: "알림", message: `${notification.type} 알림이 도착했습니다.` };
}

/** 우하단 카드용 payload. 실패가 아니라 정보성이므로 info로 보여준다. */
export function toNoticePayload(notification: AppNotification): NoticePayload {
  return { kind: "info", ...describeNotification(notification) };
}

/**
 * 이번 폴링에서 처음 보는 미읽음 알림만 고른다(오래된 순). 첫 폴링은 seen이 비어 있어도 카드로 띄우지 않도록
 * 호출자가 결과를 버리고 seen만 채운다.
 */
export function selectUnseenNotifications(seenIds: ReadonlySet<string>, notifications: readonly AppNotification[]): AppNotification[] {
  return notifications.filter((notification) => !notification.read && !seenIds.has(notification.id)).reverse();
}

/** 다음 페이지 커서. 같은 시각에 만든 알림을 건너뛰지 않도록 created_at·id를 함께 보낸다. 더 없으면 null. */
export function nextNotificationPage(notifications: readonly AppNotification[], limit: number): { before: string; beforeId: string } | null {
  if (notifications.length < limit) return null;
  const last = notifications[notifications.length - 1];
  return last ? { before: last.created_at, beforeId: last.id } : null;
}

/** 읽음 처리 뒤 목록을 서버 재조회 없이 갱신한다. ids가 null이면 전체 읽음이다. */
export function markRead(notifications: readonly AppNotification[], ids: readonly string[] | null): AppNotification[] {
  return notifications.map((notification) => (
    notification.read || (ids !== null && !ids.includes(notification.id)) ? notification : { ...notification, read: true }
  ));
}
