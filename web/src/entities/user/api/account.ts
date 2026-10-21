import { apiFetch, throwIfNotOk, parseApiError, parseJsonOrThrow, ERROR_MESSAGES } from "@/shared/api/client";
import type { UserMeResponse } from "@/entities/user/model/user";
import {
  AccountDeletionBlockedError,
  parseSoleOwnerWorkspaces,
  type AccountDeletionBody
} from "@/entities/user/model/accountDeletion";
import { parseRetryAfterSeconds, type EmailChangeBody } from "@/entities/user/model/emailChange";
import type { PasswordChangeBody } from "@/entities/user/model/passwordChange";

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

/** 프로필 사진 업로드(PUT /api/auth/me/avatar). Content-Type은 브라우저 multipart boundary에 맡긴다. */
export async function uploadAvatar(file: File): Promise<UserMeResponse> {
  const body = new FormData();
  body.append("file", file);
  const response = await apiFetch("/api/auth/me/avatar", { method: "PUT", body });
  return parseJsonOrThrow<UserMeResponse>(response, "프로필 사진을 올리지 못했습니다.");
}

/** 프로필 사진 삭제. 사진이 없어도 200이며 avatar_url이 null인 MeResponse가 온다. */
export async function deleteAvatar(): Promise<UserMeResponse> {
  const response = await apiFetch("/api/auth/me/avatar", { method: "DELETE" });
  return parseJsonOrThrow<UserMeResponse>(response, "프로필 사진을 지우지 못했습니다.");
}

/** avatar_url(GET /api/users/{id}/avatar?v=…)의 이미지를 Bearer 요청으로 받는다. <img src>로는 401이라 object URL로 보여 준다. */
export async function fetchUserAvatar(avatarUrl: string): Promise<Blob> {
  const response = await apiFetch(avatarUrl, { cache: "no-store" });
  await throwIfNotOk(response, "프로필 사진을 불러오지 못했습니다.");
  return response.blob();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await apiFetch("/api/auth/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });
  await throwIfNotOk(response, "비밀번호를 변경하지 못했습니다.");
}

type PasswordChangeVerificationResponse = {
  verification_id: string;
  expires_in: number;
  retry_after: number;
};

/** 429면 Retry-After(초)를 retryAfter로 실어 던진다. 화면이 그동안 제출을 막을 수 있게 한다. */
async function throwRateLimited(response: Response): Promise<never> {
  const apiError = await parseApiError(response, "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  throw Object.assign(apiError, { retryAfter: parseRetryAfterSeconds(response.headers.get("Retry-After")) });
}

/**
 * 로그인 상태 비밀번호 변경 1단계. 본문 없이 보내며 서버가 로그인한 계정 이메일로 인증번호(password_change)를 보낸다.
 * 소셜 전용 계정은 400 PASSWORD_LOGIN_UNAVAILABLE, 재요청 제한은 429 VERIFICATION_RATE_LIMITED(retryAfter)다.
 */
export async function requestPasswordChangeVerification(): Promise<PasswordChangeVerificationResponse> {
  const response = await apiFetch("/api/auth/me/password/verification", { method: "POST" });
  if (response.status === 429) return throwRateLimited(response);
  return parseJsonOrThrow<PasswordChangeVerificationResponse>(response, "인증번호를 보내지 못했습니다.");
}

/**
 * 로그인 상태 비밀번호 변경 3단계. 1단계 코드를 confirm해 받은 토큰과 새 비밀번호로 바꾼다(204).
 * MFA를 켠 계정은 인증 코드도 함께 보낸다. 틀리면 401 INVALID_MFA_CODE이고 토큰은 소비되지 않는다.
 * 현재 세션은 유지되고 다른 세션의 refresh token만 폐기된다.
 */
export async function changePasswordWithVerification(body: PasswordChangeBody): Promise<void> {
  const response = await apiFetch("/api/auth/me/password/verified", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await throwIfNotOk(response, "비밀번호를 변경하지 못했습니다.");
}

/**
 * 이메일 변경. 새 주소로 받은 인증 토큰과 본인 확인 값(비밀번호·MFA 코드)을 함께 보낸다.
 * 성공하면 서버가 다른 세션을 폐기하고 기존 이메일로 변경 알림을 보낸다.
 * 429는 Retry-After를 retryAfter(초)로 실어 던져 화면이 그동안 제출을 막을 수 있게 한다.
 */
export async function changeEmail(body: EmailChangeBody): Promise<UserMeResponse> {
  const response = await apiFetch("/api/auth/me/email", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status === 429) return throwRateLimited(response);
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
