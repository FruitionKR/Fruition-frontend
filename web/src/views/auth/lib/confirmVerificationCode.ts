import { confirmEmailVerification } from "@/entities/user";
import { ApiError } from "@/shared/lib/apiErrors";

/** 서버가 인증번호를 틀린 코드로 거절했다. 화면이 Figma 시안의 안내 문구(auth.verification.invalidCode)로 바꿔 보여 준다. */
export class InvalidVerificationCodeError extends Error {
  constructor() {
    super("invalid_verification_code");
    this.name = "InvalidVerificationCodeError";
  }
}

// 인증번호 검증. 서버가 400으로 거절하면(틀린 코드) InvalidVerificationCodeError로 바꿔 던진다.
export async function confirmVerificationCode(verificationId: string, code: string) {
  try {
    return await confirmEmailVerification(verificationId, code.trim());
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 400) {
      throw new InvalidVerificationCodeError();
    }
    throw error;
  }
}
