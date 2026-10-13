"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOperationLogs } from "@/entities/operation-log";
import { useMe } from "@/entities/user";
import { fetchMembers } from "@/entities/workspace/api/members";
import {
  fetchNotifications,
  markAllNotificationsRead as markAllServerNotificationsRead,
  markNotificationRead as markServerNotificationRead,
  markRead as markServerRead,
  publishNotice,
  type AppNotification
} from "@/features/document-notifications";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { buildServerNotifications, parseServerNotificationId } from "../lib/serverNotificationItems";
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
/** 서버 앱 안 알림(편집 충돌 등록·해결) 최근 개수. 1~100 */
const SERVER_NOTIFICATION_LIMIT = 50;

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
 * 작업 로그·멤버 참여에는 알림 피드·읽음 API가 없어 그 목록으로 알림을 만들고,
 * 읽음은 사용자·워크스페이스별 localStorage에 "마지막으로 모두 읽은 시각 + 개별 읽은 id"로 둔다.
 * 처음 쓰는 브라우저는 받은 목록의 가장 최근 시각을 기준점으로 삼아 과거 이력 전체가 안 읽음으로 뜨지 않게 한다.
 * 서버 앱 안 알림(편집 충돌 등록·해결)은 워크스페이스 탭에 함께 보여 주되, 읽음 상태는 서버 값을 쓰고 읽음 처리도 서버로 보낸다.
 */
export function useNotificationFeed(isViewActive: boolean) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const workspaceId = getSelectedWorkspaceId();
  const storageKey = me?.id && workspaceId ? readStateStorageKey(me.id, workspaceId) : null;
  const serverQueryKey = useMemo(() => ["app-notifications", workspaceId] as const, [workspaceId]);

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

  // 서버 앱 안 알림. 구 서버(404)·일시 실패는 멤버 알림까지 가리지 않도록 오류를 탭에 띄우지 않고 다음 폴링을 기다린다.
  const serverQuery = useQuery({
    queryKey: serverQueryKey,
    queryFn: () => fetchNotifications({ limit: SERVER_NOTIFICATION_LIMIT }),
    enabled: Boolean(workspaceId),
    refetchInterval: isViewActive ? TASK_POLL_ACTIVE_MS : TASK_POLL_IDLE_MS,
    retry: false
  });

  const taskItems = useMemo(() => buildTaskNotifications(tasksQuery.data?.logs ?? []), [tasksQuery.data]);
  // 브라우저 읽음 기록을 쓰는 알림(멤버 참여). 서버 알림은 읽음을 서버가 가지므로 기준점 계산에 넣지 않는다.
  const memberItems = useMemo(
    () => buildWorkspaceNotifications(membersQuery.data ?? [], me?.id ?? null),
    [membersQuery.data, me?.id]
  );
  const serverItems = useMemo(() => buildServerNotifications(serverQuery.data ?? []), [serverQuery.data]);
  const workspaceItems = useMemo(
    () => [...memberItems, ...serverItems].sort((a, b) => b.occurredAt - a.occurredAt),
    [memberItems, serverItems]
  );

  const allItems = useMemo(() => [...memberItems, ...taskItems], [memberItems, taskItems]);

  // 읽음 상태를 저장 키와 함께 둔다. 워크스페이스를 바꾼 직후 한 렌더 동안 이전 워크스페이스 상태가 섞이지 않게 한다.
  const [stored, setStored] = useState<{ key: string; state: NotificationReadState | null } | null>(null);
  const readState = stored && stored.key === storageKey ? stored.state : null;
  const isFeedSettled = !tasksQuery.isPending && !membersQuery.isPending;

  // 사용자·워크스페이스가 정해지면 저장된 읽음 상태를 읽는다.
  useEffect(() => {
    setStored(storageKey ? { key: storageKey, state: readStoredState(storageKey) } : null);
  }, [storageKey]);

  // 처음 쓰는 브라우저는 목록을 받은 뒤 그 가장 최근 알림 시각을 기준점으로 저장해, 과거 이력이 안 읽음으로 뜨지 않게 한다.
  // 알림 시각은 서버 값이라 기준점도 서버 시각으로 잡는다(브라우저 시계가 빠르면 새 알림이 처음부터 읽음이 된다).
  // 목록을 못 받은 쪽이 있으면 그 이력은 알 수 없으니 지금을 기준점에 더한다.
  useEffect(() => {
    if (!storageKey || stored?.key !== storageKey || stored.state || !isFeedSettled) return;
    if (readStoredState(storageKey)) return;
    const hasFailedFeed = Boolean(tasksQuery.error || membersQuery.error);
    const baseline = markAllNotificationsRead(allItems, hasFailedFeed ? Date.now() : 0);
    writeStoredState(storageKey, baseline);
    setStored({ key: storageKey, state: baseline });
  }, [allItems, isFeedSettled, membersQuery.error, storageKey, stored, tasksQuery.error]);

  const updateReadState = useCallback((update: (current: NotificationReadState) => NotificationReadState) => {
    if (!storageKey) return;
    setStored((current) => {
      if (!current || current.key !== storageKey || !current.state) return current;
      const next = update(current.state);
      if (next === current.state) return current;
      writeStoredState(storageKey, next);
      return { key: storageKey, state: next };
    });
  }, [storageKey]);

  // 서버 알림은 브라우저 읽음 기록을 아직 못 읽었어도 서버 값으로 바로 판단한다.
  const isUnread = useCallback(
    (item: NotificationItem) => (
      item.serverRead !== undefined || readState ? isNotificationUnread(item, readState ?? { lastReadAt: 0, readIds: [] }) : false
    ),
    [readState]
  );

  const hasUnreadWorkspace = workspaceItems.some(isUnread);
  const hasUnreadTask = taskItems.some(isUnread);
  const hasUnread = hasUnreadWorkspace || hasUnreadTask;

  /** 서버 알림 읽음 처리. 성공하면 캐시만 갱신하고, 실패하면 목록은 그대로 두고 카드로 알린다. */
  const readOnServer = useCallback(async (ids: string[] | null) => {
    try {
      if (ids) await Promise.all(ids.map((id) => markServerNotificationRead(id)));
      else await markAllServerNotificationsRead();
      queryClient.setQueryData<AppNotification[]>(serverQueryKey, (current) => markServerRead(current ?? [], ids));
    } catch (error) {
      publishNotice({ kind: "failed", title: "알림 읽음 처리 실패", message: getErrorMessage(error, "알림을 읽음 처리하지 못했습니다.") });
    }
  }, [queryClient, serverQueryKey]);

  const markRead = useCallback((id: string) => {
    const serverId = parseServerNotificationId(id);
    if (serverId) {
      if (serverItems.some((item) => item.id === id && item.serverRead === false)) void readOnServer([serverId]);
      return;
    }
    updateReadState((current) => markNotificationRead(current, id));
  }, [readOnServer, serverItems, updateReadState]);

  const markAllRead = useCallback(() => {
    // 서버 시각 기준으로 올린다. 브라우저 시각을 쓰면 시계가 빠를 때 그 사이 새 알림이 읽음으로 묻힌다.
    updateReadState((current) => markAllNotificationsRead(allItems, current.lastReadAt));
    if (serverItems.some((item) => item.serverRead === false)) void readOnServer(null);
  }, [allItems, readOnServer, serverItems, updateReadState]);

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
