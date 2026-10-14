import { apiFetch, throwIfNotOk, parseJsonOrThrow } from "@/shared/api/client";

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
  const data = await parseJsonOrThrow<{ sessions: LoginSession[] }>(response, "로그인된 기기를 불러오지 못했습니다.");
  return data.sessions;
}

export async function revokeSession(sessionId: number): Promise<void> {
  const response = await apiFetch(`/api/auth/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  await throwIfNotOk(response, "기기를 로그아웃하지 못했습니다.");
}
