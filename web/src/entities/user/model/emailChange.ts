// 이메일 변경(PUT /api/auth/me/email)에 쓰는 순수 로직: 요청 본문, 실패 code → 모달 상태.

export type EmailChangeBody = {
  new_email: string;
  verification_token: string;
  current_password?: string;
  mfa_code?: string;
};

/** 비밀번호·MFA 코드는 입력했을 때만 넣는다. 소셜 전용 계정은 비밀번호 없이, MFA를 끈 계정은 코드 없이 보낸다. */
export function buildEmailChangeBody(input: {
  newEmail: string;
  verificationToken: string;
  password: string;
  mfaCode: string;
}): EmailChangeBody {
  const body: EmailChangeBody = { new_email: input.newEmail.trim(), verification_token: input.verificationToken };
  if (input.password) body.current_password = input.password;
  if (input.mfaCode.trim()) body.mfa_code = input.mfaCode.trim();
  return body;
}

/**
 * 실패 뒤 모달이 할 일.
 * email: 이메일 입력으로 돌아가 주소를 고친다(형식 오류·중복).
 * code: 인증 토큰을 버리고 인증번호 단계부터 다시 한다(토큰 만료·소비·주소 불일치).
 * password / mfa: 같은 토큰으로 비밀번호·인증 코드만 다시 받는다.
 * relogin: 소셜 계정으로 다시 로그인해야 한다.
 * wait: 시도 제한. retryAfter초 동안 제출을 막는다.
 * retry: 그 밖의 실패. 같은 단계에서 다시 시도한다.
 */
export type EmailChangeRecovery = "email" | "code" | "password" | "mfa" | "relogin" | "wait" | "retry";

export type EmailChangeFailure = { recovery: EmailChangeRecovery; message: string; retryAfter?: number };

const DEFAULT_RETRY_AFTER_SECONDS = 60;

const FAILURES: Record<string, { recovery: EmailChangeRecovery; message: string }> = {
  INVALID_REQUEST: { recovery: "email", message: "이메일 주소 형식을 확인해 주세요." },
  DUPLICATE_EMAIL: { recovery: "email", message: "이미 다른 계정이 사용 중인 이메일입니다." },
  INVALID_VERIFICATION_TOKEN: { recovery: "code", message: "이메일 인증이 만료되었습니다. 인증번호를 다시 받아 입력해 주세요." },
  INVALID_CREDENTIALS: { recovery: "password", message: "비밀번호가 올바르지 않습니다." },
  INVALID_MFA_CODE: { recovery: "mfa", message: "인증 코드가 올바르지 않습니다." },
  REAUTHENTICATION_REQUIRED: {
    recovery: "relogin",
    message: "본인 확인을 위해 소셜 계정으로 다시 로그인한 뒤 10분 안에 이메일 변경을 마쳐 주세요."
  },
  PASSWORD_CHANGE_RATE_LIMITED: { recovery: "wait", message: "비밀번호 확인 시도가 너무 많습니다." },
  MFA_RATE_LIMITED: { recovery: "wait", message: "인증 코드 확인 시도가 너무 많습니다." }
};

/** Retry-After 헤더(초 또는 HTTP 날짜)를 초로 바꾼다. 없거나 읽을 수 없으면 null. */
export function parseRetryAfterSeconds(header: string | null, nowMs = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - nowMs) / 1000));
}

/** 이메일 변경 실패를 서버 error.code 기준으로 모달 상태로 바꾼다. 모르는 code면 서버 메시지, 없으면 fallback. */
export function emailChangeFailure(error: unknown, fallback: string): EmailChangeFailure {
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

/**
 * 인증번호 요청(POST /api/auth/email-verifications, purpose=email_change)의 실패 문구.
 * 다른 계정이 쓰는 주소면 서버 원문(주소 포함) 대신 변경 단계와 같은 문구를 쓴다. 그 밖의 실패는 null(호출부 문구).
 */
export function emailCodeRequestFailureMessage(error: unknown): string | null {
  const { code } = (error ?? {}) as { code?: unknown };
  return code === "DUPLICATE_EMAIL" ? FAILURES.DUPLICATE_EMAIL.message : null;
}

/** 지금 쓰는 이메일과 같은 주소인지(앞뒤 공백·대소문자 무시). 같은 주소로는 인증번호를 요청하지 않는다(서버가 409로 거절한다). */
export function isSameEmail(newEmail: string, currentEmail: string | null | undefined): boolean {
  return Boolean(currentEmail) && newEmail.trim().toLowerCase() === currentEmail!.trim().toLowerCase();
}
