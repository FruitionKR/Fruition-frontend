import type { AppNotification } from "../api/notifications";
import type { NoticePayload } from "./noticeBus";

const CHOICE_LABELS: Record<string, string> = {
  server: "서버 본을 유지",
  conflict: "내 본문을 적용",
  merged: "합친 본문을 저장"
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** 서버 알림을 사람이 읽을 제목·본문으로 바꾼다. 알림 목록과 우하단 카드가 같은 문구를 쓴다. */
export function describeNotification(notification: AppNotification): { title: string; message: string } {
  const { type, payload } = notification;
  if (type === "edit_conflict_registered") {
    const name = text(payload.document_name) ?? "문서";
    const author = text(payload.author_user_id);
    return {
      title: "편집 충돌 등록",
      message: `「${name}」에 ${author ? `${author}님의 ` : ""}편집 충돌이 등록되었습니다. 설정 > 편집 충돌에서 어느 본문을 남길지 골라 주세요.`
    };
  }
  if (type === "edit_conflict_resolved") {
    const choice = text(payload.choice);
    const resolvedBy = text(payload.resolved_by);
    const outcome = (choice && CHOICE_LABELS[choice]) ?? "해결";
    return {
      title: "편집 충돌 해결",
      message: `내가 등록한 편집 충돌을 ${resolvedBy ? `${resolvedBy}님이 ` : ""}${outcome}하는 쪽으로 해결했습니다.${choice === "server" ? " 내 본문은 충돌 기록에 남아 있습니다." : ""}`
    };
  }
  return { title: "알림", message: `${type} 알림이 도착했습니다.` };
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
