// 알림 카드 스택의 개수 제한 정책. 새 카드를 넣었을 때 어떤 카드를 내리고, 어떤 카드를 잠시 대기시킬지 정한다.

type QueuedNotice = {
  id: string;
  action?: unknown;
  subjectIds?: readonly string[];
  /** 퇴장 애니메이션 중. 개수 계산에서 빠진다. */
  leaving?: boolean;
  /** 자리가 없어 화면에서 잠시 뺀 카드. 앞 카드가 닫히면 다시 보인다. 문서 제안 억제에는 계속 센다. */
  parked?: boolean;
  /** 화면에 보이기 시작한 시각(ms). 없으면 오래전부터 보였다고 본다. */
  shownAt?: number;
};

/** 일반 카드(결과 알림)는 이만큼은 보인 뒤에야 새 카드에 밀려 닫힌다. 그 전에는 대기열로 뺐다가 다시 보여 준다. */
export const NOTICE_MIN_VISIBLE_MS = 3000;

type OverflowOptions = { max: number; now: number; minVisibleMs?: number };

function isShown(notice: QueuedNotice) {
  return !notice.leaving && !notice.parked;
}

/**
 * 보이는 카드가 max를 넘을 때 닫을 카드(evictIds)와 대기열로 뺄 카드(parkIds). 가장 최근 카드는 건드리지 않는다.
 * - 충분히(minVisibleMs) 보인 일반 카드는 닫는다(오래된 순).
 * - 그래도 넘치면 남은 카드 중 가장 오래된 카드를 대기열로 뺀다. action 카드는 사용자가 고를 때까지 닫지 않고,
 *   막 도착한 결과 카드도 다 보이기 전에 사라지지 않는다.
 */
export function planNoticeOverflow(
  notices: readonly QueuedNotice[],
  { max, now, minVisibleMs = NOTICE_MIN_VISIBLE_MS }: OverflowOptions
): { evictIds: string[]; parkIds: string[] } {
  const shown = notices.filter(isShown);
  const overflow = shown.length - max;
  if (overflow <= 0) return { evictIds: [], parkIds: [] };
  const candidates = shown.slice(0, -1);
  const evictIds = candidates
    .filter((notice) => !notice.action && now - (notice.shownAt ?? Number.NEGATIVE_INFINITY) >= minVisibleMs)
    .slice(0, overflow)
    .map((notice) => notice.id);
  const parkIds = candidates
    .filter((notice) => !evictIds.includes(notice.id))
    .slice(0, overflow - evictIds.length)
    .map((notice) => notice.id);
  return { evictIds, parkIds };
}

/** 보이는 카드가 max보다 적으면 대기열의 카드를 들어온 순서대로 다시 보인다. 바뀐 게 없으면 같은 배열을 돌려준다. */
export function promoteParkedNotices<T extends QueuedNotice>(notices: readonly T[], { max, now }: { max: number; now: number }): T[] {
  let room = max - notices.filter(isShown).length;
  if (room <= 0 || !notices.some((notice) => notice.parked && !notice.leaving)) return notices as T[];
  return notices.map((notice) => {
    if (room <= 0 || !notice.parked || notice.leaving) return notice;
    room -= 1;
    return { ...notice, parked: false, shownAt: now };
  });
}

/**
 * 새 카드를 끝에 붙이고 넘침을 정리한다. 닫을 카드는 퇴장 표시(leaving)하거나 removeImmediately면 바로 빼고,
 * 대기열로 뺄 카드는 parked로 둔다.
 */
export function enqueueNotice<T extends QueuedNotice>(
  current: readonly T[],
  notice: T,
  { max, now, removeImmediately, minVisibleMs }: OverflowOptions & { removeImmediately: boolean }
): T[] {
  const next = [...current, { ...notice, parked: false, shownAt: now }];
  const { evictIds, parkIds } = planNoticeOverflow(next, { max, now, minVisibleMs });
  if (evictIds.length === 0 && parkIds.length === 0) return next;
  const evicted = new Set(evictIds);
  const parked = new Set(parkIds);
  return next
    .filter((item) => !(removeImmediately && evicted.has(item.id)))
    .map((item) => {
      if (evicted.has(item.id)) return { ...item, leaving: true };
      if (parked.has(item.id)) return { ...item, parked: true };
      return item;
    });
}

/**
 * 화면에 있거나 대기 중인(퇴장 중 제외) 카드가 다루는 문서 id. 같은 문서로 제안 카드를 겹쳐 띄우지 않는 데 쓴다.
 * 대기열로 뺀 카드도 사용자가 아직 고르지 않았으므로 센다.
 */
export function visibleNoticeSubjectIds(notices: readonly QueuedNotice[]): Set<string> {
  return new Set(notices.filter((notice) => !notice.leaving).flatMap((notice) => notice.subjectIds ?? []));
}

/**
 * 자동 닫힘 타이머를 새로 걸어야 하는 카드 id. 퇴장 중·대기 중·action 카드(사용자가 고를 때까지 남김)·이미 타이머가 있는 카드는 뺀다.
 * 스택을 잠시 숨겼다가(좁은 화면에서 겹친 패널이 열린 동안) 다시 보일 때 남은 카드의 타이머를 새로 건다.
 */
export function selectAutoDismissIds(notices: readonly QueuedNotice[], scheduledIds: ReadonlySet<string>): string[] {
  return notices
    .filter((notice) => isShown(notice) && !notice.action && !scheduledIds.has(notice.id))
    .map((notice) => notice.id);
}

/**
 * 카드 내용을 최신 상태로 다시 맞춘다. reconcile이 null을 돌려준 카드는 닫고(removeImmediately면 바로 뺀다),
 * 바뀐 카드만 새 객체로 만든다. 바뀐 게 없으면 같은 배열을 돌려준다.
 */
export function reconcileNotices<T extends QueuedNotice>(
  notices: readonly T[],
  reconcile: (notice: T) => Partial<T> | null | undefined,
  { removeImmediately }: { removeImmediately: boolean }
): T[] {
  let changed = false;
  const next = notices.flatMap((notice): T[] => {
    if (notice.leaving) return [notice];
    const update = reconcile(notice);
    if (update === undefined) return [notice];
    if (update === null) {
      changed = true;
      return removeImmediately ? [] : [{ ...notice, leaving: true }];
    }
    const merged = { ...notice, ...update };
    if (sameNoticeContent(notice, merged)) return [notice];
    changed = true;
    return [merged];
  });
  return changed ? next : (notices as T[]);
}

function sameNoticeContent(a: object, b: object) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => {
    const left = (a as Record<string, unknown>)[key];
    const right = (b as Record<string, unknown>)[key];
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => value === right[index]);
    return Object.is(left, right);
  });
}

/**
 * 버튼에 필요한 권한(requiredPermission)이 회수된 카드 id. 권한을 아직 확인하지 못했으면(null) 내리지 않는다.
 * 이미 퇴장 중인 카드는 뺀다.
 */
export function selectPermissionRevokedIds(
  notices: readonly (QueuedNotice & { requiredPermission?: string })[],
  hasPermission: (permission: string) => boolean | null
): string[] {
  return notices
    .filter((notice) => !notice.leaving && notice.requiredPermission && hasPermission(notice.requiredPermission) === false)
    .map((notice) => notice.id);
}
