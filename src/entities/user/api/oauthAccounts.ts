import { apiFetch, throwIfNotOk, parseJsonOrThrow } from "@/shared/api/client";
import type { OAuthProvider } from "./login";

/** 소셜 계정 연동을 시작할 1회용 토큰(60초)을 받는다. */
export async function startOAuthLink(provider: OAuthProvider): Promise<string> {
  const response = await apiFetch(`/api/auth/me/oauth-accounts/${encodeURIComponent(provider)}/link`, { method: "POST" });
  const data = await parseJsonOrThrow<{ link_token: string }>(response, "소셜 계정 연동을 시작하지 못했습니다.");
  return data.link_token;
}

/** 연동 콜백이 넘긴 link_code로 소셜 계정을 지금 로그인한 계정에 연결한다. */
export async function confirmOAuthLink(linkCode: string): Promise<void> {
  const response = await apiFetch("/api/auth/me/oauth-accounts/link/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ link_code: linkCode })
  });
  await throwIfNotOk(response, "소셜 계정을 연동하지 못했습니다.");
}

export async function unlinkOAuthAccount(provider: OAuthProvider): Promise<void> {
  const response = await apiFetch(`/api/auth/me/oauth-accounts/${encodeURIComponent(provider)}`, { method: "DELETE" });
  await throwIfNotOk(response, "소셜 계정 연동을 해제하지 못했습니다.");
}
