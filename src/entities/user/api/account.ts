import { apiFetch, throwIfNotOk, parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";
import type { UserMeResponse } from "@/entities/user/model/auth";

/** 로그인한 사용자 정보를 가져온다. */
export async function fetchMe(): Promise<UserMeResponse> {
  const response = await apiFetch("/api/auth/me", { cache: "no-store" });
  return parseJsonOrThrow<UserMeResponse>(response, ERROR_MESSAGES.meLoadFailed);
}

export async function updateDisplayName(displayName: string): Promise<UserMeResponse> {
  const response = await apiFetch("/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName })
  });
  return parseJsonOrThrow<UserMeResponse>(response, "닉네임을 변경하지 못했습니다.");
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await apiFetch("/api/auth/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });
  await throwIfNotOk(response, "비밀번호를 변경하지 못했습니다.");
}

export async function changeEmail(newEmail: string, verificationToken: string): Promise<UserMeResponse> {
  const response = await apiFetch("/api/auth/me/email", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_email: newEmail, verification_token: verificationToken })
  });
  return parseJsonOrThrow<UserMeResponse>(response, "이메일을 변경하지 못했습니다.");
}
