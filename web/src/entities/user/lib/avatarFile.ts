import { ApiError } from "@/shared/lib/apiErrors";

/** 서버 계약(PUT /api/auth/me/avatar)과 같은 상한. 서버는 매직 바이트로 판별하므로 여기서는 보내기 전 선검사만 한다. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_ACCEPT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const AVATAR_ACCEPT = AVATAR_ACCEPT_TYPES.join(",");

const UNSUPPORTED_MESSAGE = "PNG·JPEG·WebP·GIF 이미지만 올릴 수 있습니다.";
const TOO_LARGE_MESSAGE = "1MB 이하 이미지를 선택해 주세요.";

/** 업로드 전 클라이언트 선검사. 문제가 없으면 null, 있으면 안내 문구를 돌려준다. */
export function validateAvatarFile(file: { size: number; type: string }): string | null {
  if (file.size === 0) return "빈 파일은 사용할 수 없습니다. " + TOO_LARGE_MESSAGE;
  if (!(AVATAR_ACCEPT_TYPES as readonly string[]).includes(file.type)) return UNSUPPORTED_MESSAGE;
  if (file.size > AVATAR_MAX_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

/** 서버 거절 코드를 안내 문구로 바꾼다. 400 UNSUPPORTED_USER_AVATAR·413 USER_AVATAR_TOO_LARGE 외에는 서버 메시지나 fallback을 쓴다. */
export function avatarUploadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.code === "UNSUPPORTED_USER_AVATAR") return UNSUPPORTED_MESSAGE;
    if (error.status === 413) return TOO_LARGE_MESSAGE;
  }
  return error instanceof Error ? error.message : fallback;
}

/** 사진이 없을 때 보여 줄 이니셜. 이름이 비면 "사용자"의 첫 글자다. */
export function avatarInitial(name: string | null | undefined): string {
  return (name?.trim() || "사용자").charAt(0);
}
