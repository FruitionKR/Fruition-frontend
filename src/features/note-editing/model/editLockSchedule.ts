import { ERROR_MESSAGES } from "@/shared/api/client";
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

/** 423 보유자 안내 문구. 표시 이름이 없으면 누구인지 밝히지 않고 편집 중임만 알린다. */
export function describeEditLockHolder(lock: EditLockResponse): string {
  const holder = lock.holder_display_name?.trim();
  return holder ? `${holder}님이 편집 중입니다.` : ERROR_MESSAGES.editLockHeld;
}
