import { apiFetch, getWorkspaceId, parseJsonOrThrow, throwIfNotOk, workspacePath } from "@/shared/api/client";

/** 지금 서버가 만드는 앱 안 알림 종류. 모르는 type은 문자열로 받아 일반 문구로 보여준다. */
export type AppNotificationType = "edit_conflict_registered" | "edit_conflict_resolved" | (string & {});

export type AppNotification = {
  id: string;
  type: AppNotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
};

export type NotificationListQuery = {
  unreadOnly?: boolean;
  /** 기본 50, 1~100 */
  limit?: number;
  /** 다음 페이지: 마지막 항목의 created_at·id */
  before?: string;
  beforeId?: string;
};

/** 나에게 보이는 알림을 최신순으로 받는다. */
export async function fetchNotifications(query: NotificationListQuery = {}): Promise<AppNotification[]> {
  const params = new URLSearchParams();
  if (query.unreadOnly) params.set("unread_only", "true");
  if (query.limit) params.set("limit", String(query.limit));
  if (query.before) params.set("before", query.before);
  if (query.beforeId) params.set("before_id", query.beforeId);
  const search = params.size > 0 ? `?${params.toString()}` : "";
  const response = await apiFetch(`${workspacePath(getWorkspaceId(), "notifications")}${search}`, { cache: "no-store" });
  const data = await parseJsonOrThrow<{ notifications: AppNotification[] }>(response, "알림을 불러오지 못했습니다.");
  return Array.isArray(data.notifications) ? data.notifications : [];
}

/** 알림 하나를 읽음 처리한다. 이미 읽었어도 204다. */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "notifications", notificationId, "read"), { method: "POST" });
  await throwIfNotOk(response, "알림을 읽음 처리하지 못했습니다.");
}

/** 지금 나에게 보이는 알림을 모두 읽음 처리한다. */
export async function markAllNotificationsRead(): Promise<void> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "notifications", "read-all"), { method: "POST" });
  await throwIfNotOk(response, "알림을 모두 읽음 처리하지 못했습니다.");
}
