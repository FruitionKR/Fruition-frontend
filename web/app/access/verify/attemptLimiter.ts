// 서버 전용: 접근 코드 확인(POST /access/verify)의 클라이언트별 실패 횟수 제한.
// Pod 메모리 기준이라 레플리카마다 따로 센다. 분산 IP 대입은 WAF rate 규칙이 맡고, 이것은 단일 출처의 빠른 대입을 막는 보완책이다.

export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 10 * 60_000;
// 키가 끝없이 늘지 않도록 상한을 둔다. 꽉 차면 만료된 항목부터, 그래도 꽉 차면 가장 오래된 항목부터 지운다.
export const MAX_TRACKED_CLIENTS = 10_000;
const UNKNOWN_CLIENT = "unknown";

type FailureRecord = { count: number; windowStart: number };

const failures = new Map<string, FailureRecord>();

/**
 * 클라이언트 키. ALB는 받은 x-forwarded-for 뒤에 실제 접속 IP를 덧붙이므로, 클라이언트가 위조할 수 있는 첫 hop이 아니라
 * 마지막 hop을 쓴다(ALB → Pod 한 단계 구성 기준, Next는 값이 있으면 덧붙이지 않는다). 헤더가 없으면(로컬) 상수 키로 모은다.
 */
export function getClientKey(forwardedFor: string | null): string {
  const hops = forwardedFor?.split(",").map((hop) => hop.trim()).filter(Boolean) ?? [];
  return hops.at(-1) ?? UNKNOWN_CLIENT;
}

function activeRecord(key: string, now: number): FailureRecord | null {
  const record = failures.get(key);
  if (!record) return null;
  if (now - record.windowStart < FAILURE_WINDOW_MS) return record;
  failures.delete(key);
  return null;
}

/** 차단 중이면 남은 시간(ms), 아니면 0. 차단 중에는 맞는 코드도 확인하지 않는다. */
export function getBlockedMs(key: string, now: number): number {
  const record = activeRecord(key, now);
  if (!record || record.count < MAX_FAILURES) return 0;
  return record.windowStart + FAILURE_WINDOW_MS - now;
}

export function recordFailure(key: string, now: number): void {
  const record = activeRecord(key, now);
  if (record) {
    failures.set(key, { ...record, count: record.count + 1 });
    return;
  }
  if (failures.size >= MAX_TRACKED_CLIENTS) evict(now);
  failures.set(key, { count: 1, windowStart: now });
}

export function resetFailures(key: string): void {
  failures.delete(key);
}

function evict(now: number): void {
  for (const [key, record] of failures) {
    if (now - record.windowStart >= FAILURE_WINDOW_MS) failures.delete(key);
  }
  // Map은 삽입 순서를 지키므로 첫 키가 가장 먼저 기록된 클라이언트다.
  const oldest = failures.keys().next();
  if (failures.size >= MAX_TRACKED_CLIENTS && !oldest.done) failures.delete(oldest.value);
}
