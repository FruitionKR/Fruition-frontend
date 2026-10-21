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
type Subscription = { listener: Listener; key?: string };
const subscriptions = new Set<Subscription>();

/** 같은 워크스페이스의 신호를 이 시간 안에서는 한 번으로 합친다(403이 한꺼번에 여러 건 와도 역할을 한 번만 다시 받게). */
export const PERMISSION_SIGNAL_COALESCE_MS = 2_000;
const lastNotifiedAt = new Map<string, number>();

/**
 * 권한 부족 신호를 구독한 화면에 알린다. 같은 워크스페이스 신호가 PERMISSION_SIGNAL_COALESCE_MS 안에 다시 오면 건너뛰고,
 * 같은 key로 구독한 화면들(같은 역할 조회를 쓰는 여러 컴포넌트)에는 한 번만 알린다.
 */
export function notifyWorkspacePermissionDenied(workspaceId: string, now = Date.now()) {
  const last = lastNotifiedAt.get(workspaceId);
  if (last !== undefined && now - last < PERMISSION_SIGNAL_COALESCE_MS) return;
  lastNotifiedAt.set(workspaceId, now);
  const notifiedKeys = new Set<string>();
  [...subscriptions].forEach(({ listener, key }) => {
    if (key !== undefined) {
      if (notifiedKeys.has(key)) return;
      notifiedKeys.add(key);
    }
    listener(workspaceId);
  });
}

/** key가 같은 구독은 신호 하나에 한 번만 불린다(먼저 구독한 쪽). */
export function subscribeWorkspacePermissionDenied(listener: Listener, key?: string): () => void {
  const subscription: Subscription = { listener, key };
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
  };
}
