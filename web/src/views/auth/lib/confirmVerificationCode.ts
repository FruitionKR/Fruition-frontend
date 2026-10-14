import { confirmEmailVerification } from "@/entities/user";
import { ApiError } from "@/shared/lib/apiErrors";

const INVALID_VERIFICATION_CODE_MESSAGE = "잘못된 인증번호입니다. 다시 확인해주세요.";

// 인증번호 검증. 서버가 400으로 거절하면(틀린 코드) Figma 시안의 안내 문구로 바꿔 던진다.
export async function confirmVerificationCode(verificationId: string, code: string) {
  try {
    return await confirmEmailVerification(verificationId, code.trim());
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 400) {
      throw new Error(INVALID_VERIFICATION_CODE_MESSAGE);
    }
    throw error;
  }
}
