/**
 * 내 저장 공간(GET /api/workspaces/{id}/storage) 표시 규칙. 용량은 워크스페이스가 아니라 사용자 단위이고,
 * used_bytes는 내가 모든 워크스페이스에 올린 합계다. limit_bytes가 null이면 한도가 꺼져 사용량만 보인다.
 * 테스트가 hook 없이 import할 수 있게 다른 모듈을 import하지 않는다.
 */

export type StorageUsageResponse = { used_bytes: number; limit_bytes: number | null; scope?: string };

/** 이 비율 이상 쓰면 경고 색으로 보인다. */
export const STORAGE_WARNING_RATIO = 0.9;

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const STEP = 1024;

/** 사람이 읽는 용량. 소수 첫째 자리까지, .0은 뗀다(5GB, 1.2GB, 512KB). */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (unit < UNITS.length - 1 && value >= STEP) {
    value /= STEP;
    unit += 1;
  }
  let rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  // 1023.96KB처럼 반올림하면 다음 단위가 되는 값은 1MB로 올린다.
  if (rounded >= STEP && unit < UNITS.length - 1) {
    rounded = Math.round((rounded / STEP) * 10) / 10;
    unit += 1;
  }
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${UNITS[unit]}`;
}

export type StorageUsageView = {
  label: string;
  /** 한도가 없으면 null(막대를 그리지 않는다). 0~100 */
  percent: number | null;
  isWarning: boolean;
};

export function describeStorageUsage(storage: StorageUsageResponse): StorageUsageView {
  const used = formatBytes(storage.used_bytes);
  if (storage.limit_bytes === null) return { label: `내 저장 공간 ${used} 사용`, percent: null, isWarning: false };
  const ratio = storage.limit_bytes > 0 ? storage.used_bytes / storage.limit_bytes : 1;
  return {
    label: `내 저장 공간 ${used} / ${formatBytes(storage.limit_bytes)} 사용`,
    percent: Math.min(100, Math.max(0, Math.round(ratio * 100))),
    isWarning: ratio >= STORAGE_WARNING_RATIO
  };
}

/** 서버 응답을 확인한다. 모양이 다르면 표시하지 않도록 null을 돌려준다. */
export function parseStorageUsage(body: unknown): StorageUsageResponse | null {
  if (!body || typeof body !== "object") return null;
  const { used_bytes: used, limit_bytes: limit, scope } = body as Record<string, unknown>;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  if (limit !== null && (typeof limit !== "number" || !Number.isFinite(limit))) return null;
  return { used_bytes: used, limit_bytes: limit, ...(typeof scope === "string" ? { scope } : {}) };
}
