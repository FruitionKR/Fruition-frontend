import { apiFetch, throwIfNotOk, parseJsonOrThrow } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";

export type LoginSession = {
  session_id: number;
  user_agent: string | null;
  current: boolean;
  created_at: string;
  expires_at: string;
};

export const SESSIONS_QUERY_KEY = ["login-sessions"] as const;

export async function fetchSessions(): Promise<LoginSession[]> {
  const response = await apiFetch("/api/auth/me/sessions", { cache: "no-store" });
  const data = await parseJsonOrThrow<{ sessions: LoginSession[] }>(response, sharedText("user.requestFailed.sessions", "로그인된 기기를 불러오지 못했습니다."));
  return data.sessions;
}

export async function revokeSession(sessionId: number): Promise<void> {
  const response = await apiFetch(`/api/auth/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  await throwIfNotOk(response, sharedText("user.requestFailed.sessionRevoke", "기기를 로그아웃하지 못했습니다."));
}
