import type { OperationLogItem, OperationType } from "@/entities/operation-log";
import type { WorkspaceMember } from "@/entities/workspace/api/members";

/** 알림 화면 하위 탭 (Figma 1486:3178). 워크스페이스 = 멤버 등 워크스페이스 이벤트, 작업 = AI 작업 종결 이력 */
export type NotificationCategory = "workspace" | "task";

export type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  /** 알림이 생긴 시각(ms). 정렬·읽음 판단·상대 시간 표시의 기준 */
  occurredAt: number;
  /** 작업이 바꾼 문서 수. 칩으로 보여 주며 0이거나 작업이 아니면 null */
  changeCount: number | null;
  tone: "success" | "failure";
  /** 알림을 눌렀을 때 펼쳐 보여 줄 짧은 설명 줄 */
  details: string[];
  /** 작업 알림이면 로그 화면에서 열 작업 id */
  operationId?: string;
};

/** "마지막으로 모두 읽은 시각" 이후의 알림 중 개별로 읽은 id만 따로 기억한다. 백엔드에 읽음 상태가 없어 브라우저에 둔다. */
export type NotificationReadState = {
  lastReadAt: number;
  readIds: readonly string[];
};

/** 개별 읽음 기록 상한. 오래된 것부터 버린다(전체 읽음 시각보다 오래된 알림은 어차피 읽음이다). */
export const MAX_READ_IDS = 200;

// 작업 알림 제목에 쓰는 작업 종류 이름.
const TASK_LABELS: Record<OperationType, string> = {
  ingest: "문서 처리",
  lint: "위키 다듬기",
  restore: "복구(롤백)",
  document_edit: "AI 편집 반영"
};

const TERMINAL_STATUS_TEXT: Record<string, { label: string; sentence: string; tone: NotificationItem["tone"] }> = {
  succeeded: { label: "완료", sentence: "완료되었습니다.", tone: "success" },
  partially_succeeded: { label: "일부 완료", sentence: "일부만 완료되었습니다.", tone: "success" },
  failed: { label: "실패", sentence: "실패했습니다.", tone: "failure" },
  conflict: { label: "충돌", sentence: "충돌로 끝났습니다.", tone: "failure" }
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function byNewest(a: NotificationItem, b: NotificationItem) {
  return b.occurredAt - a.occurredAt;
}

/** 로그 화면과 같은 규칙: 문서 이름과 요약이 다르면 "문서 / 요약", 하나만 있으면 그것만 */
function describeOperation(log: OperationLogItem, fallback: string) {
  const name = log.target_display_name?.trim();
  const summary = log.summary?.trim();
  if (name && summary && name !== summary) return `${name} / ${summary}`;
  return name || summary || fallback;
}

/**
 * 작업 알림: 종결된 AI 작업 로그(문서 처리·위키 다듬기·복구·AI 편집). 진행 중 작업과
 * 바꾼 문서 없이 성공한 lint(로그 화면에서도 숨김)는 뺀다.
 */
export function buildTaskNotifications(logs: readonly OperationLogItem[]): NotificationItem[] {
  return logs.flatMap((log): NotificationItem[] => {
    const status = TERMINAL_STATUS_TEXT[log.status];
    if (!status) return [];
    if (log.operation_type === "lint" && log.status === "succeeded" && log.changed_resource_count === 0) return [];
    const occurredAt = parseTime(log.completed_at) ?? parseTime(log.created_at);
    if (occurredAt === null) return [];
    const label = TASK_LABELS[log.operation_type] ?? log.operation_type;
    return [{
      id: `task:${log.operation_id}`,
      category: "task",
      title: `${label} ${status.label}`,
      description: describeOperation(log, `${label} 작업이 ${status.sentence}`),
      occurredAt,
      changeCount: log.changed_resource_count > 0 ? log.changed_resource_count : null,
      details: [
        `${label} 작업이 ${status.sentence}`,
        ...(log.target_display_name?.trim() ? [`대상 문서: ${log.target_display_name.trim()}`] : []),
        ...(log.summary?.trim() ? [`요약: ${log.summary.trim()}`] : []),
        ...(log.changed_resource_count > 0 ? [`바뀐 문서 ${log.changed_resource_count}개`] : [])
      ],
      tone: status.tone,
      operationId: log.operation_id
    }];
  }).sort(byNewest);
}

/** 워크스페이스 알림: 나를 뺀 멤버의 참여. 백엔드에 워크스페이스 이벤트 피드가 없어 멤버 목록의 참여 시각으로 만든다. */
export function buildWorkspaceNotifications(
  members: readonly WorkspaceMember[],
  myUserId: string | null
): NotificationItem[] {
  return members.flatMap((member): NotificationItem[] => {
    if (member.user_id === myUserId) return [];
    const occurredAt = parseTime(member.joined_at);
    if (occurredAt === null) return [];
    const displayName = member.display_name?.trim();
    const name = displayName || member.email;
    return [{
      id: `member:${member.user_id}`,
      category: "workspace",
      title: "새 멤버 참여",
      description: `${name}님이 워크스페이스에 참여했습니다.`,
      occurredAt,
      changeCount: null,
      details: [
        displayName ? `${displayName} (${member.email})` : member.email,
        `역할: ${member.role === "OWNER" ? "소유자" : "멤버"}`
      ],
      tone: "success"
    }];
  }).sort(byNewest);
}

export function isNotificationUnread(
  item: Pick<NotificationItem, "id" | "occurredAt">,
  state: NotificationReadState
): boolean {
  return item.occurredAt > state.lastReadAt && !state.readIds.includes(item.id);
}

export function countUnreadNotifications(
  items: readonly Pick<NotificationItem, "id" | "occurredAt">[],
  state: NotificationReadState
): number {
  return items.filter((item) => isNotificationUnread(item, state)).length;
}

export function markNotificationRead(state: NotificationReadState, id: string): NotificationReadState {
  if (state.readIds.includes(id)) return state;
  return { ...state, readIds: [...state.readIds, id].slice(-MAX_READ_IDS) };
}

/** 서버 시각이 브라우저 시계보다 앞서도 지금 보이는 알림이 모두 읽음이 되도록 가장 늦은 알림 시각까지 올린다. */
export function markAllNotificationsRead(
  items: readonly Pick<NotificationItem, "occurredAt">[],
  now: number
): NotificationReadState {
  const latest = items.reduce((max, item) => Math.max(max, item.occurredAt), now);
  return { lastReadAt: latest, readIds: [] };
}

/** 저장된 읽음 상태. 없거나 형식이 깨졌으면 null(호출부가 지금을 기준점으로 새로 만든다). */
export function parseReadState(raw: string | null): NotificationReadState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { lastReadAt, readIds } = value as { lastReadAt?: unknown; readIds?: unknown };
    if (typeof lastReadAt !== "number" || !Number.isFinite(lastReadAt)) return null;
    const ids = Array.isArray(readIds) ? readIds.filter((id): id is string => typeof id === "string") : [];
    return { lastReadAt, readIds: ids };
  } catch {
    return null;
  }
}

export function readStateStorageKey(userId: string, workspaceId: string): string {
  return `fruition.notifications_read.${userId}.${workspaceId}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_DAYS_LIMIT = 7;

/** 목록 오른쪽 시간 (Figma "지금" / "1분 전"). 일주일이 넘으면 날짜, 올해가 아니면 연도까지 쓴다. */
export function formatNotificationTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (elapsed < MINUTE_MS) return "지금";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}분 전`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}시간 전`;
  if (elapsed < RELATIVE_DAYS_LIMIT * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}일 전`;
  const date = new Date(timestamp);
  const monthDay = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${date.getFullYear()}년 ${monthDay}`;
}
