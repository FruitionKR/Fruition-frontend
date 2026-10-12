"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  describeNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markRead,
  type AppNotification
} from "@/features/document-notifications";
import { getErrorMessage } from "@/shared/lib/errors";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { cx } from "@/shared/lib/classNames";
import styles from "./CollabSections.module.css";

const PAGE_LIMIT = 50;
const NOTIFICATIONS_QUERY_KEY = (workspaceId: string | null) => ["app-notifications", workspaceId] as const;

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/** 서버 앱 안 알림 목록(최신 50개)과 읽음 처리. 로컬 알림 설정(위키 편입 알림 켜기/끄기)과는 별개다. */
export function NotificationSection() {
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const queryKey = NOTIFICATIONS_QUERY_KEY(workspaceId);
  const notifications = useQuery({
    queryKey,
    queryFn: () => fetchNotifications({ limit: PAGE_LIMIT }),
    enabled: Boolean(workspaceId)
  });
  const [message, setMessage] = useState<string | null>(null);
  const items = notifications.data ?? [];
  const unreadCount = items.filter((item) => !item.read).length;

  /** 읽음 처리 성공 시 목록을 재조회 없이 갱신한다. 실패하면 문구만 보이고 목록은 그대로다. */
  async function read(ids: string[] | null) {
    setMessage(null);
    try {
      if (ids) await Promise.all(ids.map((id) => markNotificationRead(id)));
      else await markAllNotificationsRead();
      queryClient.setQueryData<AppNotification[]>(queryKey, (current) => markRead(current ?? [], ids));
    } catch (error) {
      setMessage(getErrorMessage(error, "알림을 읽음 처리하지 못했습니다."));
    }
  }

  return (
    <section className={styles["settings-section"]} aria-labelledby="app-notifications-heading">
      <div className={styles["settings-list-row"]}>
        <h3 id="app-notifications-heading">알림{unreadCount > 0 ? ` (읽지 않음 ${unreadCount})` : ""}</h3>
        <button
          type="button"
          className={styles["settings-small-button"]}
          disabled={unreadCount === 0}
          onClick={() => void read(null)}
        >
          모두 읽음
        </button>
      </div>
      <p className={styles["settings-section-description"]}>편집 충돌 등록·해결 같은 워크스페이스 알림입니다. 최근 {PAGE_LIMIT}개를 보여줍니다.</p>
      {notifications.isLoading && <p className={styles["settings-list-empty"]}>알림을 불러오는 중입니다.</p>}
      {notifications.isError && (
        <p className={styles["settings-message"]} role="alert">{getErrorMessage(notifications.error, "알림을 불러오지 못했습니다.")}</p>
      )}
      {!notifications.isLoading && !notifications.isError && items.length === 0 && (
        <p className={styles["settings-list-empty"]}>알림이 없습니다.</p>
      )}
      <ul className={styles["settings-list"]}>
        {items.map((item) => {
          const { title, message: body } = describeNotification(item);
          return (
            <li key={item.id} className={cx(styles["settings-list-item"], item.read && styles["is-read"])}>
              <div className={styles["settings-list-row"]}>
                <div className={styles["settings-label"]}>
                  <p>{title}{item.read ? "" : " · 읽지 않음"}</p>
                  <span>{formatTime(item.created_at)} · {body}</span>
                </div>
                {!item.read && (
                  <button type="button" className={styles["settings-small-button"]} onClick={() => void read([item.id])}>읽음</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {message && <p className={styles["settings-message"]} role="alert">{message}</p>}
    </section>
  );
}
