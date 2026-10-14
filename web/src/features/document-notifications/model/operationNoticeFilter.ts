import type { NoticePayload } from "./noticeBus";

// 오래된 작업 id는 다시 알림이 올 일이 없으므로 최근 것만 기억한다.
const MAX_TRACKED_OPERATIONS = 200;

/**
 * lint·restore 작업 알림을 거르는 필터. 유형 설정이 꺼져 있으면 숨기고,
 * 같은 operation id는 처음 한 번만 통과시킨다 (직접 발행과 로그 폴링의 중복 방지).
 * operation이 없는 알림(요청 실패 등 사용자 동작의 즉시 피드백)은 항상 통과한다.
 */
export function createOperationNoticeFilter(maxTracked = MAX_TRACKED_OPERATIONS) {
  const shownIds = new Set<string>();
  return (notice: NoticePayload, enabled: Record<"lint" | "restore", boolean>) => {
    const { operation } = notice;
    if (!operation) return true;
    if (!enabled[operation.type]) return false;
    if (!operation.id) return true;
    if (shownIds.has(operation.id)) return false;
    shownIds.add(operation.id);
    if (shownIds.size > maxTracked) shownIds.delete(shownIds.values().next().value as string);
    return true;
  };
}
