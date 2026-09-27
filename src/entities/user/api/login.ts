import { parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";

export type AuthTokensResponse = {
  access_token: string;
  mfa_required?: false;
};

export type LoginResponse = AuthTokensResponse | { mfa_required: true; mfa_token: string };

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
export type OAuthProvider = "google" | "naver" | "kakao";

export async function loginWithEmail(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  return parseJsonOrThrow<LoginResponse>(response, ERROR_MESSAGES.loginFailed);
}

export function getOAuthAuthorizationUrl(provider: OAuthProvider): string {
  // next.config.mjs의 redirects()가 access-svc 오리진으로 307 리다이렉트한다.
  // redirect_uri가 서버 자신 오리진 기준이라 rewrite(프록시)가 아닌 redirect여야 한다.
  return `/oauth2/authorization/${provider}`;
}

export async function exchangeOAuthCode(code: string): Promise<LoginResponse> {
  const response = await fetch("/api/auth/oauth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });

  return parseJsonOrThrow<LoginResponse>(response, ERROR_MESSAGES.loginFailed);
}
