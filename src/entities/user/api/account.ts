import { apiFetch, throwIfNotOk, parseApiError, parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";
import type { UserMeResponse } from "@/entities/user/model/auth";
import {
  AccountDeletionBlockedError,
  parseSoleOwnerWorkspaces,
  type AccountDeletionBody
} from "@/entities/user/model/accountDeletion";

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

/**
 * 회원 탈퇴. 성공하면 204이고 refresh 쿠키도 지워진다.
 * 409(다른 멤버가 있는 워크스페이스의 유일한 OWNER)는 workspaces를 함께 던져 화면이 목록을 보여 줄 수 있게 한다.
 */
export async function deleteAccount(body: AccountDeletionBody): Promise<void> {
  const response = await apiFetch("/api/auth/me", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status === 409) {
    const parsed = await response.clone().json().catch(() => null) as unknown;
    const apiError = await parseApiError(response, "회원 탈퇴를 진행할 수 없습니다.");
    throw new AccountDeletionBlockedError(apiError.message, parseSoleOwnerWorkspaces(parsed));
  }
  await throwIfNotOk(response, "회원 탈퇴에 실패했습니다.");
}
