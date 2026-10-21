/** 로컬 개발 환경에서 메일 없이 쓰는 고정 인증번호(4자리). 운영(production) 빌드에서는 받지 않는다. */
export const DEVELOPMENT_VERIFICATION_CODE = "9700";

/** 개발 환경에서 입력한 값이 고정 인증번호인지. 운영에서는 항상 false라 6자리 검증만 남는다. */
export function isDevelopmentVerificationCode(code: string, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production" && code.trim() === DEVELOPMENT_VERIFICATION_CODE;
}

/** 이메일 인증번호 입력 라벨. 운영은 6자리만 안내하고, 개발 환경은 고정 인증번호도 받는다는 것을 함께 적는다. */
export function verificationCodeLabel(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  return nodeEnv === "production" ? "인증번호 6자리" : `인증번호 6자리 (개발: ${DEVELOPMENT_VERIFICATION_CODE})`;
}
