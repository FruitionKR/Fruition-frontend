/**
 * 접근할 수 없게 된 워크스페이스(멤버에서 내보내짐·워크스페이스 삭제). 열린 탭이 그 워크스페이스를 계속 폴링하면
 * 404 WORKSPACE_NOT_FOUND가 쏟아지고 지난 트리가 남으므로, 한 번 확인되면 그 워크스페이스로 가는 요청을 멈추고
 * 화면은 안내로 바꾼다. 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

/** document-svc·access-svc 모두 멤버가 아니거나 없는 워크스페이스에 이 코드를 준다(document ADR 0030). */
export const WORKSPACE_NOT_FOUND_CODE = "WORKSPACE_NOT_FOUND";

const WORKSPACE_PATH_PATTERN = /^\/api\/workspaces\/([^/?#]+)(?:[/?#]|$)/;

/** `/api/workspaces/{id}`·`/api/workspaces/{id}/…` 경로의 워크스페이스 id. 목록(`/api/workspaces`)이나 다른 경로면 null. */
export function workspaceIdFromPath(path: string): string | null {
  const match = WORKSPACE_PATH_PATTERN.exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 이 응답이 선택한 워크스페이스에 더 이상 접근할 수 없다는 뜻인지.
 * 조회(GET)의 404 WORKSPACE_NOT_FOUND만 본다. access-svc는 OWNER 전용 변경을 멤버가 보내도 같은 404를 주므로
 * 변경 요청의 404로는 판단하지 않는다.
 */
export function isWorkspaceGoneResponse({
  path,
  method,
  status,
  code,
  selectedWorkspaceId
}: {
  path: string;
  method: string | undefined;
  status: number;
  code: string | undefined;
  selectedWorkspaceId: string | null;
}): boolean {
  if (status !== 404 || code !== WORKSPACE_NOT_FOUND_CODE) return false;
  if ((method ?? "GET").toUpperCase() !== "GET") return false;
  const workspaceId = workspaceIdFromPath(path);
  return workspaceId !== null && workspaceId === selectedWorkspaceId;
}

const goneWorkspaceIds = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function markWorkspaceGone(workspaceId: string) {
  if (goneWorkspaceIds.has(workspaceId)) return;
  goneWorkspaceIds.add(workspaceId);
  version += 1;
  listeners.forEach((listener) => listener());
}

/**
 * 접근 불가 기록을 지운다. 같은 탭에서 초대를 다시 수락했거나 워크스페이스를 다시 고르면
 * 그 워크스페이스로 가는 요청을 다시 보내야 한다(기록이 남으면 apiFetch가 계속 막는다).
 */
export function clearWorkspaceGone(workspaceId: string) {
  if (!goneWorkspaceIds.delete(workspaceId)) return;
  version += 1;
  listeners.forEach((listener) => listener());
}

export function isWorkspaceGone(workspaceId: string | null): boolean {
  return workspaceId !== null && goneWorkspaceIds.has(workspaceId);
}

/** 요청 경로가 접근할 수 없게 된 워크스페이스로 가는지. 참이면 보내지 않는다. */
export function isRequestToGoneWorkspace(path: string): boolean {
  return isWorkspaceGone(workspaceIdFromPath(path));
}

export function subscribeWorkspaceGone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore 스냅샷. 바뀔 때마다 값이 달라진다. */
export function getWorkspaceGoneVersion(): number {
  return version;
}

/** 테스트용: 기록을 비운다. */
export function resetWorkspaceGone() {
  goneWorkspaceIds.clear();
  version += 1;
}
