"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOperationLogs } from "@/entities/operation-log";
import { useMe } from "@/entities/user";
import { fetchMembers } from "@/entities/workspace/api/members";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import {
  buildTaskNotifications,
  buildWorkspaceNotifications,
  isNotificationUnread,
  markAllNotificationsRead,
  markNotificationRead,
  parseReadState,
  readStateStorageKey,
  type NotificationItem,
  type NotificationReadState
} from "../lib/notificationFeed";

/** 작업 알림으로 보여 줄 최신 로그 수. 백엔드 최대 100건 */
const TASK_PAGE_SIZE = 30;
// 알림 화면을 보는 중에는 빨리, 다른 화면에서는 레일 점만 갱신하면 되므로 느리게 받는다.
const TASK_POLL_ACTIVE_MS = 5_000;
const TASK_POLL_IDLE_MS = 30_000;
const MEMBER_POLL_MS = 60_000;

function readStoredState(key: string): NotificationReadState | null {
  try {
    return parseReadState(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStoredState(key: string, state: NotificationReadState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // 저장소를 못 쓰는 환경에서는 이번 세션 동안만 읽음 상태를 유지한다.
  }
}

/**
 * 알림 목록(워크스페이스·작업)과 읽음 상태.
 * 백엔드에 알림 피드·읽음 API가 없어 작업 로그·멤버 목록으로 목록을 만들고,
 * 읽음은 사용자·워크스페이스별 localStorage에 "마지막으로 모두 읽은 시각 + 개별 읽은 id"로 둔다.
 * 처음 쓰는 브라우저는 지금을 기준점으로 삼아 과거 이력 전체가 안 읽음으로 뜨지 않게 한다.
 */
export function useNotificationFeed(isViewActive: boolean) {
  const { data: me } = useMe();
  const workspaceId = getSelectedWorkspaceId();
  const storageKey = me?.id && workspaceId ? readStateStorageKey(me.id, workspaceId) : null;

  const tasksQuery = useQuery({
    queryKey: ["notification-operation-logs", workspaceId],
    queryFn: () => fetchOperationLogs({ size: TASK_PAGE_SIZE }),
    enabled: Boolean(workspaceId),
    refetchInterval: isViewActive ? TASK_POLL_ACTIVE_MS : TASK_POLL_IDLE_MS,
    retry: false
  });
  // 멤버 관리 패널과 같은 캐시를 쓴다.
  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => fetchMembers(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: MEMBER_POLL_MS,
    retry: false
  });

  const taskItems = useMemo(() => buildTaskNotifications(tasksQuery.data?.logs ?? []), [tasksQuery.data]);
  const workspaceItems = useMemo(
    () => buildWorkspaceNotifications(membersQuery.data ?? [], me?.id ?? null),
    [membersQuery.data, me?.id]
  );

  const [readState, setReadState] = useState<NotificationReadState | null>(null);

  // 사용자·워크스페이스가 정해지면 저장된 읽음 상태를 읽고, 없으면 지금을 기준점으로 저장한다.
  useEffect(() => {
    if (!storageKey) {
      setReadState(null);
      return;
    }
    const stored = readStoredState(storageKey);
    if (stored) {
      setReadState(stored);
      return;
    }
    const baseline: NotificationReadState = { lastReadAt: Date.now(), readIds: [] };
    writeStoredState(storageKey, baseline);
    setReadState(baseline);
  }, [storageKey]);

  const updateReadState = useCallback((update: (current: NotificationReadState) => NotificationReadState) => {
    if (!storageKey) return;
    setReadState((current) => {
      if (!current) return current;
      const next = update(current);
      if (next !== current) writeStoredState(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const isUnread = useCallback(
    (item: NotificationItem) => (readState ? isNotificationUnread(item, readState) : false),
    [readState]
  );

  const allItems = useMemo(() => [...workspaceItems, ...taskItems], [taskItems, workspaceItems]);
  const hasUnreadWorkspace = workspaceItems.some(isUnread);
  const hasUnreadTask = taskItems.some(isUnread);
  const hasUnread = hasUnreadWorkspace || hasUnreadTask;

  const markRead = useCallback((id: string) => {
    updateReadState((current) => markNotificationRead(current, id));
  }, [updateReadState]);

  const markAllRead = useCallback(() => {
    updateReadState(() => markAllNotificationsRead(allItems, Date.now()));
  }, [allItems, updateReadState]);

  return {
    workspace: {
      items: workspaceItems,
      hasUnread: hasUnreadWorkspace,
      isLoading: membersQuery.isPending && Boolean(workspaceId),
      errorMessage: membersQuery.error ? getErrorMessage(membersQuery.error, "멤버 목록을 불러오지 못했습니다.") : null
    },
    task: {
      items: taskItems,
      hasUnread: hasUnreadTask,
      isLoading: tasksQuery.isPending && Boolean(workspaceId),
      errorMessage: tasksQuery.error ? getErrorMessage(tasksQuery.error, "작업 알림을 불러오지 못했습니다.") : null
    },
    hasUnread,
    isUnread,
    markRead,
    markAllRead
  };
}

export type NotificationFeed = ReturnType<typeof useNotificationFeed>;
