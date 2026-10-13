"use client";

import { useEffect, useRef } from "react";
import { fetchNotifications } from "../api/notifications";
import { publishNotice } from "./noticeBus";
import { selectUnseenNotifications, toNoticePayload } from "./serverNotifications";

const POLL_INTERVAL_MS = 30_000;
const PAGE_LIMIT = 50;

/**
 * 서버 앱 안 알림(편집 충돌 등록·해결)을 폴링해 새로 생긴 미읽음 알림을 우하단 카드로 띄운다.
 * 첫 폴링은 이미 쌓인 알림을 카드로 쏟지 않고 본 것으로만 기록한다. 목록·읽음 처리는 레일 알림 화면의 워크스페이스 탭에서 한다.
 * 숨김 탭에서는 멈추고 돌아오면 바로 한 번 폴링한다.
 */
export function useServerNotifications() {
  const seenIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function poll() {
      let notifications;
      try {
        notifications = await fetchNotifications({ unreadOnly: true, limit: PAGE_LIMIT });
      } catch {
        // 워크스페이스 미선택·구 서버(404)·일시 실패는 다음 폴링에서 다시 시도한다.
        schedule();
        return;
      }
      if (cancelled) return;
      const seen = seenIdsRef.current;
      if (seen) selectUnseenNotifications(seen, notifications).forEach((notification) => publishNotice(toNoticePayload(notification)));
      seenIdsRef.current = new Set([...(seen ?? []), ...notifications.map((notification) => notification.id)]);
      schedule();
    }

    function schedule() {
      if (cancelled || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    function resumeWhenVisible() {
      if (document.visibilityState === "hidden") return;
      window.clearTimeout(timer);
      void poll();
    }

    document.addEventListener("visibilitychange", resumeWhenVisible);
    void poll();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.clearTimeout(timer);
    };
  }, []);
}
