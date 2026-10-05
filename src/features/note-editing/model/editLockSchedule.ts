import { ERROR_MESSAGES } from "@/shared/api/client";
import { SessionExpiredError } from "@/shared/lib/errors";
import type { EditLockResponse } from "../api/editLock";

/** 만료가 임박해도 초당 요청으로 번지지 않게 하는 하한. */
export const HEARTBEAT_MIN_MS = 5_000;
/** 서버 TTL이 길어도 잠금 상실(409)을 늦게 알아차리지 않게 하는 상한. */
export const HEARTBEAT_MAX_MS = 60_000;
/** expires_at이 없거나 깨져 있을 때만 쓰는 보수적인 고정 주기. */
export const HEARTBEAT_FALLBACK_MS = 15_000;

/**
 * 다음 heartbeat까지의 대기 시간. 응답 시점에 남은 TTL의 1/3을 쓴다.
 * 1/3이면 만료 전에 두 번 더 시도할 수 있어 한 번의 실패·지연으로 잠금을 잃지 않는다.
 * ttl_ms가 있으면 그것을, 없으면(구버전 서버) expires_at과 nowMs의 차이를 남은 TTL로 본다.
 */
export function resolveHeartbeatDelayMs(expiresAt: string | undefined, nowMs: number, ttlMs?: number): number {
  const remaining = resolveLockRemainingMs({ expires_at: expiresAt, ttl_ms: ttlMs }, nowMs);
  if (remaining === null) return HEARTBEAT_FALLBACK_MS;
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, Math.floor(remaining / 3)));
}

/** heartbeat 실패 후 다시 시도하기까지의 간격. 만료 전까지 이 간격으로 계속 두드린다. */
export const HEARTBEAT_RETRY_MS = 5_000;

/** expires_at을 밀리초로 바꾼다. 없거나 깨져 있으면 null. */
export function parseLockExpiryMs(expiresAt: string | undefined): number | null {
  if (!expiresAt) return null;
  const expiresMs = Date.parse(expiresAt);
  return Number.isNaN(expiresMs) ? null : expiresMs;
}

/**
 * 응답 시점에 잠금이 남은 시간(ms). 판단 근거가 없으면 null.
 * ttl_ms는 서버 시계 기준이라 클라이언트 시계 차이에 영향받지 않는다.
 * ttl_ms가 없는 구버전 서버 응답이면 expires_at을 클라이언트 시계(wallNowMs)로 뺀다.
 */
export function resolveLockRemainingMs(
  lock: Pick<EditLockResponse, "expires_at" | "ttl_ms">,
  wallNowMs: number
): number | null {
  if (typeof lock.ttl_ms === "number" && Number.isFinite(lock.ttl_ms)) return lock.ttl_ms;
  const expiresMs = parseLockExpiryMs(lock.expires_at);
  return expiresMs === null ? null : expiresMs - wallNowMs;
}

/** 잠금 요청을 보낸 시점의 단조 시계·벽시계 값. 남은 시간을 셀 기준점이다. */
export type LockClockAnchor = { monoMs: number; wallMs: number };

/**
 * 기준점 이후 흐른 시간(ms). 단조 시계와 벽시계 중 더 많이 흐른 쪽을 쓴다.
 * 단조 시계(performance.now())는 브라우저에 따라 절전 중 멈추고, 벽시계는 사용자가 바꿀 수 있다.
 * 더 큰 경과를 쓰면 어느 쪽이 틀려도 만료를 늦게 알아차리지 않는다(이르게 알면 재획득으로 확인한다).
 */
export function resolveLockElapsedMs(anchor: LockClockAnchor, monoNowMs: number, wallNowMs: number): number {
  return Math.max(monoNowMs - anchor.monoMs, wallNowMs - anchor.wallMs);
}

export type HeartbeatFailureAction = "retry" | "reacquire" | "terminal";

/**
 * heartbeat 실패를 재시도할지, 재획득할지, 잠금 상실로 끝낼지 정한다.
 *
 * 종료 시점은 임의의 실패 횟수가 아니라 서버가 준 잠금 만료 시점이어야 한다.
 * deadlineMs와 nowMs는 같은 기준이어야 한다(useEditLock은 기준점 이후 남은 시간과 흐른 시간을 넘긴다).
 * 만료 전이라면 서버 잠금은 아직 우리 것이므로, 터널·엘리베이터 같은 일시적인
 * 연결 상실 중에도 편집기를 닫지 않고 계속 시도한다.
 * 만료 후에는 보유 중이라고 주장하지 않고 재획득으로 사실을 확인한다.
 */
export function resolveHeartbeatFailure(
  error: unknown,
  deadlineMs: number | null,
  nowMs: number
): HeartbeatFailureAction {
  // 세션 만료는 기다려도 회복되지 않는다.
  if (error instanceof SessionExpiredError) return "terminal";
  if (deadlineMs === null) return "reacquire";
  return nowMs < deadlineMs ? "retry" : "reacquire";
}

/** 423 보유자 안내 문구. 표시 이름이 없으면 누구인지 밝히지 않고 편집 중임만 알린다. */
export function describeEditLockHolder(lock: EditLockResponse): string {
  const holder = lock.holder_display_name?.trim();
  return holder ? `${holder}님이 편집 중입니다.` : ERROR_MESSAGES.editLockHeld;
}
