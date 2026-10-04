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

/** heartbeat를 이만큼 연속으로 실패하면 더 이상 잠금을 보유한다고 보지 않는다. */
export const HEARTBEAT_MAX_CONSECUTIVE_FAILURES = 3;

/**
 * heartbeat 실패를 재시도할지, 잠금 상실로 끝낼지 정한다.
 * 세션 만료는 기다려도 회복되지 않고, 연속 실패가 한도를 넘으면 서버 잠금은 이미 만료됐을 가능성이 높다.
 * 이때까지 granted를 유지하면 다른 사용자가 잠금을 가져간 뒤에도 양쪽이 보유 중이라고 믿는다.
 */
export function resolveHeartbeatFailure(
  error: unknown,
  consecutiveFailures: number
): "retry" | "terminal" {
  if (error instanceof SessionExpiredError) return "terminal";
  return consecutiveFailures >= HEARTBEAT_MAX_CONSECUTIVE_FAILURES ? "terminal" : "retry";
}

/** 423 보유자 안내 문구. 표시 이름이 없으면 누구인지 밝히지 않고 편집 중임만 알린다. */
export function describeEditLockHolder(lock: EditLockResponse): string {
  const holder = lock.holder_display_name?.trim();
  return holder ? `${holder}님이 편집 중입니다.` : ERROR_MESSAGES.editLockHeld;
}
