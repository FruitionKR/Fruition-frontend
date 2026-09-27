import { apiFetch, throwIfNotOk, parseJsonOrThrow } from "@/shared/api/client";
import type { AuthTokensResponse } from "./login";

export async function loginWithMfa(mfaToken: string, code: string): Promise<AuthTokensResponse> {
  const response = await fetch("/api/auth/login/mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mfa_token: mfaToken, code })
  });
  return parseJsonOrThrow<AuthTokensResponse>(response, "다단계 인증에 실패했습니다.");
}

export type MfaStatus = { enabled: boolean; activated_at: string | null; remaining_recovery_codes: number };
export type MfaRegistration = { secret: string; otpauth_uri: string; recovery_codes: string[] };
export const MFA_QUERY_KEY = ["mfa-status"] as const;

export async function fetchMfaStatus(): Promise<MfaStatus> {
  const response = await apiFetch("/api/auth/me/mfa", { cache: "no-store" });
  return parseJsonOrThrow<MfaStatus>(response, "다단계 인증 상태를 불러오지 못했습니다.");
}

export async function registerMfa(): Promise<MfaRegistration> {
  const response = await apiFetch("/api/auth/me/mfa", { method: "POST" });
  return parseJsonOrThrow<MfaRegistration>(response, "다단계 인증 등록을 시작하지 못했습니다.");
}

export async function activateMfa(code: string): Promise<void> {
  const response = await apiFetch("/api/auth/me/mfa/activate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
  });
  await throwIfNotOk(response, "다단계 인증을 활성화하지 못했습니다.");
}

export async function disableMfa(code: string): Promise<void> {
  const response = await apiFetch("/api/auth/me/mfa", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
  });
  await throwIfNotOk(response, "다단계 인증을 해제하지 못했습니다.");
}
