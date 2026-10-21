// 로그인 상태 비밀번호 변경(POST /api/auth/me/password/verification → confirm → PUT /api/auth/me/password/verified,
// 또는 현재 비밀번호로 PUT /api/auth/me/password)의 요청 본문과 실패 code → 모달 상태 변환. 이 파일은 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.

export type PasswordChangeBody = {
  new_password: string;
  verification_token: string;
  mfa_code?: string;
};

/** MFA 코드는 입력했을 때만 넣는다. MFA를 끈 계정은 코드 없이 보낸다. */
export function buildPasswordChangeBody(input: {
  newPassword: string;
  verificationToken: string;
  mfaCode: string;
}): PasswordChangeBody {
  const body: PasswordChangeBody = { new_password: input.newPassword, verification_token: input.verificationToken };
  if (input.mfaCode.trim()) body.mfa_code = input.mfaCode.trim();
  return body;
}

export type CurrentPasswordChangeBody = {
  current_password: string;
  new_password: string;
  mfa_code?: string;
};

/** 현재 비밀번호 방식도 MFA 코드는 입력했을 때만 넣는다. MFA를 끈 계정은 기존 본문 그대로다. */
export function buildCurrentPasswordChangeBody(input: {
  currentPassword: string;
  newPassword: string;
  mfaCode: string;
}): CurrentPasswordChangeBody {
  const body: CurrentPasswordChangeBody = { current_password: input.currentPassword, new_password: input.newPassword };
  if (input.mfaCode.trim()) body.mfa_code = input.mfaCode.trim();
  return body;
}

/**
 * 실패 뒤 모달이 할 일.
 * unavailable: 비밀번호가 없는 소셜 전용 계정이다. 이 화면에서는 비밀번호를 정할 수 없다고 안내하고 진행을 막는다.
 * resend: 인증 토큰이 만료·소비됐다. 토큰을 버리고 인증번호를 새로 받는 단계로 돌아간다.
 * mfa: 인증 코드가 틀렸다. 토큰은 소비되지 않았으므로 같은 토큰으로 인증 코드만 다시 받는다.
 * wait: 재요청 제한. retryAfter초 동안 인증번호 요청을 막는다.
 * retry: 그 밖의 실패(비밀번호 정책 위반·메일 발송 실패 등). 같은 단계에서 다시 시도한다.
 */
export type PasswordChangeRecovery = "unavailable" | "resend" | "mfa" | "wait" | "retry";

export type PasswordChangeFailure = { recovery: PasswordChangeRecovery; message: string; retryAfter?: number };

const DEFAULT_RETRY_AFTER_SECONDS = 60;

const FAILURES: Record<string, { recovery: PasswordChangeRecovery; message: string }> = {
  PASSWORD_LOGIN_UNAVAILABLE: {
    recovery: "unavailable",
    message: "소셜 계정으로 가입한 계정은 여기서 비밀번호를 설정할 수 없습니다. 연동한 소셜 계정으로 로그인해 주세요."
  },
  INVALID_VERIFICATION_TOKEN: {
    recovery: "resend",
    message: "이메일 인증이 만료되었습니다. 인증번호를 다시 받아 입력해 주세요."
  },
  INVALID_MFA_CODE: { recovery: "mfa", message: "인증 코드가 올바르지 않습니다." },
  VERIFICATION_RATE_LIMITED: { recovery: "wait", message: "인증번호 요청이 너무 많습니다." },
  EMAIL_SEND_FAILED: { recovery: "retry", message: "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요." }
};

/** 비밀번호 변경 실패를 서버 error.code 기준으로 모달 상태로 바꾼다. 모르는 code면 서버 메시지, 없으면 fallback. */
export function passwordChangeFailure(error: unknown, fallback: string): PasswordChangeFailure {
  const { code, status, retryAfter } = (error ?? {}) as { code?: unknown; status?: unknown; retryAfter?: unknown };
  const known = typeof code === "string" ? FAILURES[code] : undefined;
  if (known?.recovery === "wait" || (!known && status === 429)) {
    const seconds = typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS;
    const reason = known?.message ?? "시도가 너무 많습니다.";
    return { recovery: "wait", message: `${reason} ${seconds}초 후 다시 시도해 주세요.`, retryAfter: seconds };
  }
  if (known) return { ...known };
  return { recovery: "retry", message: error instanceof Error && error.message ? error.message : fallback };
}
