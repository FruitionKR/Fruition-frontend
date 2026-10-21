// useGraphWikiActions 테스트용 가짜. 권한 훅은 값을 바꿀 수 있게 하고, 알림·위키 최신화 API는 호출만 기록한다.
export const wikiActionPermissions = { canIngest: true, canLint: true };
export const lintCalls = [];
export const notices = [];

export function useWikiActionPermissions() {
  return { ...wikiActionPermissions };
}

export async function fetchWikiMaintenanceStatus() {
  lintCalls.push("status");
  return { needs_lint: true };
}

export async function requestWikiLint(dryRun) {
  lintCalls.push(dryRun ? "dry-run" : "lint");
  return { changedPageCount: 1, operationId: "op_1" };
}

export function publishNotice(notice) {
  notices.push(notice);
}
