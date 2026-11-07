import { ApiError } from "@/shared/lib/apiErrors";

/** auth.loginErrors 아래 메시지 키. */
export type LoginErrorKey = "invalidCredentials" | "serverPreparing" | "tooManyAttempts" | "serverError" | "networkError";

/**
 * 로그인 실패 원인을 사용자 문구로 바꾼다. translate는 auth.loginErrors 키를 현재 언어 문구로 바꾼다.
 * 자격 증명 오류(400·401)만 "아이디·비밀번호" 문구를 쓰고, 그 밖의 실패(차단·서버 오류·네트워크 단절)는
 * 비밀번호를 의심하지 않도록 실제 원인을 안내한다.
 */
export function getLoginErrorMessage(error: unknown, isServerUnready: boolean, translate: (key: LoginErrorKey) => string): string {
  if (isServerUnready) return translate("serverPreparing");
  if (!(error instanceof ApiError)) return translate("networkError");
  if (error.status === 400 || error.status === 401) return translate("invalidCredentials");
  if (error.status === 429) return translate("tooManyAttempts");
  if (error.status >= 500) return translate("serverError");
  return error.message;
}
