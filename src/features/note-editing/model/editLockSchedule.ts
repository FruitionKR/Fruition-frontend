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
 * 다음 heartbeat까지의 대기 시간. 서버가 준 expires_at에서 남은 TTL의 1/3을 쓴다.
 * 1/3이면 만료 전에 두 번 더 시도할 수 있어 한 번의 실패·지연으로 잠금을 잃지 않는다.
 */
export function resolveHeartbeatDelayMs(expiresAt: string | undefined, nowMs: number): number {
  if (!expiresAt) return HEARTBEAT_FALLBACK_MS;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return HEARTBEAT_FALLBACK_MS;
  const remaining = expiresMs - nowMs;
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

export type HeartbeatFailureAction = "retry" | "reacquire" | "terminal";

/**
 * heartbeat 실패를 재시도할지, 재획득할지, 잠금 상실로 끝낼지 정한다.
 *
 * 종료 시점은 임의의 실패 횟수가 아니라 서버가 준 expires_at이어야 한다.
 * 만료 전이라면 서버 잠금은 아직 우리 것이므로, 터널·엘리베이터 같은 일시적인
 * 연결 상실 중에도 편집기를 닫지 않고 계속 시도한다.
 * 만료 후에는 보유 중이라고 주장하지 않고 재획득으로 사실을 확인한다.
 */
export function resolveHeartbeatFailure(
  error: unknown,
  expiresAtMs: number | null,
  nowMs: number
): HeartbeatFailureAction {
  // 세션 만료는 기다려도 회복되지 않는다.
  if (error instanceof SessionExpiredError) return "terminal";
  if (expiresAtMs === null) return "reacquire";
  return nowMs < expiresAtMs ? "retry" : "reacquire";
}

/** 423 보유자 안내 문구. 표시 이름이 없으면 누구인지 밝히지 않고 편집 중임만 알린다. */
export function describeEditLockHolder(lock: EditLockResponse): string {
  const holder = lock.holder_display_name?.trim();
  return holder ? `${holder}님이 편집 중입니다.` : ERROR_MESSAGES.editLockHeld;
}
