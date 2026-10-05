// access token은 페이지 수명 동안 메모리에만 보관한다.
// refresh token은 백엔드가 발급하는 HttpOnly 쿠키에 있어 JavaScript에서 읽을 수 없다.
const ACCESS_TOKEN_STORAGE_KEY = "fruition.access_token";
const REFRESH_TOKEN_STORAGE_KEY = "fruition.refresh_token";
const WORKSPACE_STORAGE_KEY = "fruition.workspace_id";
const AFTER_LOGIN_STORAGE_KEY = "fruition.after_login";
const AUTH_REFRESH_LOCK_NAME = "fruition.auth.refresh";
const PUBLIC_AUTH_PATHS = new Set([
  "/",
  "/forgot-password",
  "/login",
  "/oauth/callback",
  "/reset-password",
  "/signup",
  "/signup/verify"
]);

let accessToken: string | null = null;
// 동시에 터진 401이 처리기를 N번 호출해 queryClient.clear()·router.replace를 반복하지 않게 하는 래치.
let hasNotifiedSessionExpired = false;
// 재발급까지 실패해 세션이 끝난 순간을 앱 전체가 한 곳에서 처리하도록 등록하는 처리기.
let sessionExpiredHandler: (() => void) | null = null;

/** 세션 만료 시 재인증(로그아웃 후 /login) 처리기를 등록한다. 앱 루트에서 한 번만 등록한다. */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler;
}

/** refresh까지 실패해 더 이상 인증된 요청을 보낼 수 없을 때 호출한다. */
export function notifySessionExpired() {
  if (hasNotifiedSessionExpired) return;
  hasNotifiedSessionExpired = true;
  sessionExpiredHandler?.();
}

/** 세션 만료를 알린 뒤 아직 로그인·재발급으로 새 access token을 받지 못했으면 참이다. */
export function isSessionExpired(): boolean {
  return hasNotifiedSessionExpired;
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

export function getAccessToken(): string | null {
  removeLegacyStoredTokens();
  return accessToken;
}

export function saveAccessToken(token: string) {
  removeLegacyStoredTokens();
  accessToken = token;
  // 로그인·재발급이 성공했으면 다음 만료는 다시 알려야 한다.
  hasNotifiedSessionExpired = false;
}

export function clearAuth() {
  accessToken = null;
  removeLegacyStoredTokens();
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(pathname) || /^\/invitations\/[^/]+$/.test(pathname);
}

/** 같은 origin의 여러 탭이 refresh 쿠키를 동시에 회전하지 않도록 직렬화한다. */
export async function withAuthRefreshLock<T>(refresh: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return refresh();
  return await navigator.locks.request(AUTH_REFRESH_LOCK_NAME, refresh);
}

function removeLegacyStoredTokens() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
}

export function getSelectedWorkspaceId(): string | null {
  return readStorage(WORKSPACE_STORAGE_KEY);
}

export function setSelectedWorkspaceId(workspaceId: string) {
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
}

export function clearSelectedWorkspaceId() {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

/** 로그인을 마친 뒤 돌아올 화면을 남긴다. 로그인이 OAuth로 오리진을 벗어나도 같은 탭이면 유지된다. */
export function setAfterLoginPath(path: string) {
  window.sessionStorage.setItem(AFTER_LOGIN_STORAGE_KEY, path);
}

/** 로그인 직후 이동할 경로. 남겨 둔 경로는 한 번만 쓴다. */
export function takeAfterLoginPath(): string {
  const path = window.sessionStorage.getItem(AFTER_LOGIN_STORAGE_KEY);
  window.sessionStorage.removeItem(AFTER_LOGIN_STORAGE_KEY);
  return path ?? "/workspaces";
}
