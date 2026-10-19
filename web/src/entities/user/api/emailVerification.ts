import { throwIfNotOk, parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";
import type { SignupConsentFields } from "@/entities/user/model/consent";

type EmailVerificationResponse = {
  verification_id: string;
  expires_in: number;
  retry_after: number;
};

type EmailAvailabilityResponse = {
  available: boolean;
  /** 같은 이메일로 소셜 가입한 계정의 provider(이름순). 비어 있지 않으면 프론트가 이메일 가입을 막는다. */
  oauth_providers?: string[];
};

type VerificationConfirmResponse = {
  verification_token: string;
  expires_in: number;
};

export async function requestEmailVerification(
  email: string,
  purpose: "signup" | "password_reset" | "email_change"
): Promise<EmailVerificationResponse> {
  const response = await fetch("/api/auth/email-verifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, purpose })
  });

  return parseJsonOrThrow<EmailVerificationResponse>(response, "인증번호 요청에 실패했습니다.");
}

export async function checkEmailAvailability(email: string): Promise<EmailAvailabilityResponse> {
  const response = await fetch("/api/auth/email-availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  return parseJsonOrThrow<EmailAvailabilityResponse>(response, "이메일 중복 확인에 실패했습니다.");
}

export async function confirmEmailVerification(
  verificationId: string,
  code: string
): Promise<VerificationConfirmResponse> {
  const response = await fetch(
    `/api/auth/email-verifications/${encodeURIComponent(verificationId)}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    }
  );

  return parseJsonOrThrow<VerificationConfirmResponse>(response, "인증번호 확인에 실패했습니다.");
}

export async function signupWithEmail(
  email: string,
  password: string,
  displayName: string,
  verificationToken: string,
  /** 동의 UI가 꺼져 있으면 빈 객체라 동의 필드를 보내지 않는다. */
  consent: SignupConsentFields
): Promise<void> {
  const response = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      display_name: displayName,
      verification_token: verificationToken,
      ...consent
    })
  });

  await throwIfNotOk(response, ERROR_MESSAGES.signupFailed);
}

export async function resetPasswordWithVerification(
  email: string,
  newPassword: string,
  verificationToken: string
): Promise<void> {
  const response = await fetch("/api/auth/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      new_password: newPassword,
      verification_token: verificationToken
    })
  });

  await throwIfNotOk(response, "비밀번호 재설정에 실패했습니다.");
}
