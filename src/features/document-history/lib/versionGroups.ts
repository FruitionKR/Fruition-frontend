/** 버전 목록을 묶는 기본 간격. 자동 저장마다 쌓이는 버전을 이 간격의 스냅샷처럼 보여 준다. */
export const VERSION_GROUP_INTERVAL_MS = 10 * 60_000;

type GroupableVersion = {
  version: number;
  created_at: string;
};

/**
 * 버전을 created_at 기준 시간 버킷(intervalMs)으로 묶어 버킷마다 마지막 버전만 남긴다.
 * 현재 버전은 버킷과 상관없이 항상 남긴다. 시각을 읽을 수 없는 버전은 묶지 않고 그대로 둔다.
 * 입력 순서(서버 응답은 최신 순)를 유지한다.
 */
export function groupVersionsByInterval<T extends GroupableVersion>(
  versions: readonly T[],
  intervalMs: number,
  currentVersion: number | null
): T[] {
  const latestByBucket = new Map<string, number>();
  const bucketOf = (item: T) => {
    const time = Date.parse(item.created_at);
    return Number.isNaN(time) ? `version:${item.version}` : `bucket:${Math.floor(time / intervalMs)}`;
  };
  for (const item of versions) {
    const bucket = bucketOf(item);
    const latest = latestByBucket.get(bucket);
    if (latest === undefined || item.version > latest) latestByBucket.set(bucket, item.version);
  }
  return versions.filter((item) => item.version === currentVersion || latestByBucket.get(bucketOf(item)) === item.version);
}
