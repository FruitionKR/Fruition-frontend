import { apiFetch, parseJsonOrThrow, throwIfNotOk, ERROR_MESSAGES } from "@/shared/api/client";
import type { ConsentBody } from "@/entities/user/model/consent";
import type { LoginResponse } from "./login";

/** 소셜 신규 가입자의 동의를 받아 계정을 만들고 로그인시킨다. 응답은 로그인 응답과 같다(MFA 포함). */
export async function completeOAuthSignup(signupToken: string, consent: ConsentBody): Promise<LoginResponse> {
  const response = await fetch("/api/auth/oauth/signup/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signup_token: signupToken, ...consent })
  });
  return parseJsonOrThrow<LoginResponse>(response, ERROR_MESSAGES.signupFailed);
}

/** 이용약관이 바뀐 기존 회원의 재동의를 기록한다. */
export async function submitConsents(consent: ConsentBody): Promise<void> {
  const response = await apiFetch("/api/auth/me/consents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(consent)
  });
  await throwIfNotOk(response, "약관 동의를 저장하지 못했습니다.");
}
