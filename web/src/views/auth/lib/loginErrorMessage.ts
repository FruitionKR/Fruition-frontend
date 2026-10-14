import { ApiError } from "@/shared/lib/apiErrors";

export const INVALID_CREDENTIALS_MESSAGE = "가입하지 않은 아이디거나, 잘못된 비밀번호입니다.";
export const SERVER_PREPARING_MESSAGE = "서버가 아직 준비 중이에요. 준비가 끝나면 다시 로그인해 주세요.";
export const TOO_MANY_LOGIN_ATTEMPTS_MESSAGE = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
export const LOGIN_SERVER_ERROR_MESSAGE = "서버 오류로 로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
export const LOGIN_NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

/**
 * 로그인 실패 원인을 사용자 문구로 바꾼다.
 * 자격 증명 오류(400·401)만 "아이디·비밀번호" 문구를 쓰고, 그 밖의 실패(차단·서버 오류·네트워크 단절)는
 * 비밀번호를 의심하지 않도록 실제 원인을 안내한다.
 */
export function getLoginErrorMessage(error: unknown, isServerUnready: boolean): string {
  if (isServerUnready) return SERVER_PREPARING_MESSAGE;
  if (!(error instanceof ApiError)) return LOGIN_NETWORK_ERROR_MESSAGE;
  if (error.status === 400 || error.status === 401) return INVALID_CREDENTIALS_MESSAGE;
  if (error.status === 429) return TOO_MANY_LOGIN_ATTEMPTS_MESSAGE;
  if (error.status >= 500) return LOGIN_SERVER_ERROR_MESSAGE;
  return error.message;
}
