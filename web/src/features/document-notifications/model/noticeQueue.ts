// 알림 카드 스택의 개수 제한 정책. 새 카드를 넣었을 때 어떤 카드를 밀어낼지 정한다.

type QueuedNotice = {
  id: string;
  action?: unknown;
  subjectIds?: readonly string[];
  /** 퇴장 애니메이션 중. 개수 계산에서 빠진다. */
  leaving?: boolean;
};

/**
 * 퇴장 중이 아닌 카드가 max를 넘을 때 밀어낼 카드 id (오래된 순).
 * 가장 최근 카드는 밀어내지 않는다. 일반 카드를 먼저 밀어내고,
 * 남은 카드가 모두 action 카드일 때만 가장 오래된 action 카드를 밀어낸다.
 */
export function selectEvictedNoticeIds(notices: readonly QueuedNotice[], max: number): string[] {
  const active = notices.filter((notice) => !notice.leaving);
  const overflow = active.length - max;
  if (overflow <= 0) return [];
  const candidates = active.slice(0, -1);
  const plain = candidates.filter((notice) => !notice.action);
  const withAction = candidates.filter((notice) => notice.action);
  return [...plain, ...withAction].slice(0, overflow).map((notice) => notice.id);
}

/** 새 카드를 끝에 붙이고, 넘친 카드는 퇴장 표시(leaving)하거나 removeImmediately면 바로 뺀다. */
export function enqueueNotice<T extends QueuedNotice>(
  current: readonly T[],
  notice: T,
  { max, removeImmediately }: { max: number; removeImmediately: boolean }
): T[] {
  const next = [...current, notice];
  const evicted = new Set(selectEvictedNoticeIds(next, max));
  if (evicted.size === 0) return next;
  if (removeImmediately) return next.filter((item) => !evicted.has(item.id));
  return next.map((item) => (evicted.has(item.id) ? { ...item, leaving: true } : item));
}

/** 화면에 남아 있는(퇴장 중 제외) 카드가 다루는 문서 id. 같은 문서로 제안 카드를 겹쳐 띄우지 않는 데 쓴다. */
export function visibleNoticeSubjectIds(notices: readonly QueuedNotice[]): Set<string> {
  return new Set(notices.filter((notice) => !notice.leaving).flatMap((notice) => notice.subjectIds ?? []));
}

/**
 * 자동 닫힘 타이머를 새로 걸어야 하는 카드 id. 퇴장 중·action 카드(사용자가 고를 때까지 남김)·이미 타이머가 있는 카드는 뺀다.
 * 스택을 잠시 숨겼다가(좁은 화면에서 겹친 패널이 열린 동안) 다시 보일 때 남은 카드의 타이머를 새로 건다.
 */
export function selectAutoDismissIds(notices: readonly QueuedNotice[], scheduledIds: ReadonlySet<string>): string[] {
  return notices
    .filter((notice) => !notice.leaving && !notice.action && !scheduledIds.has(notice.id))
    .map((notice) => notice.id);
}
