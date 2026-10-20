/**
 * 서버가 권한 부족(403 WORKSPACE_PERMISSION_REQUIRED)으로 거절한 워크스페이스 요청 신호.
 * OWNER가 권한을 회수해도 멤버 화면은 역할 캐시(staleTime) 동안 버튼을 열어 두므로, 이 신호를 받으면 본인 역할·권한을
 * 바로 다시 받아 화면을 맞춘다. 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

/** apiErrors의 WORKSPACE_PERMISSION_REQUIRED_CODE와 같은 값(이 모듈은 import 없이 둔다). */
const PERMISSION_REQUIRED_CODE = "WORKSPACE_PERMISSION_REQUIRED";

const WORKSPACE_PATH_PATTERN = /^\/api\/workspaces\/([^/?#]+)(?:[/?#]|$)/;

/** 권한 부족으로 거절된 워크스페이스 요청이면 그 워크스페이스 id, 아니면 null. */
export function permissionDeniedWorkspaceId(path: string, status: number, code: string | undefined): string | null {
  if (status !== 403 || code !== PERMISSION_REQUIRED_CODE) return null;
  const match = WORKSPACE_PATH_PATTERN.exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}

type Listener = (workspaceId: string) => void;
const listeners = new Set<Listener>();

export function notifyWorkspacePermissionDenied(workspaceId: string) {
  listeners.forEach((listener) => listener(workspaceId));
}

export function subscribeWorkspacePermissionDenied(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
