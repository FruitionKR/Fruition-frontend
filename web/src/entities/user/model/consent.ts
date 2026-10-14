// 가입 동의(만 18세 확인·이용약관·마케팅)와 재동의에 쓰는 순수 로직.
// 약관 버전은 호출부가 src/shared/config/legal.ts의 LEGAL_TERMS_VERSION을 넘긴다(node:test에서 별칭 없이 쓰기 위해 import하지 않는다).

export type ConsentChoices = {
  ageConfirmed: boolean;
  termsAccepted: boolean;
  marketingOptIn: boolean;
};

/** 어떤 항목도 미리 체크하지 않는다(다크패턴 가이드라인의 사전 선택 금지). */
export const EMPTY_CONSENT: ConsentChoices = { ageConfirmed: false, termsAccepted: false, marketingOptIn: false };

/** 필수 항목(만 18세 확인, 이용약관 동의)을 모두 체크했는지. 마케팅은 선택이다. */
export function isConsentComplete(choices: ConsentChoices): boolean {
  return choices.ageConfirmed && choices.termsAccepted;
}

export type ConsentBody = {
  age_confirmed: boolean;
  terms_version: string;
  marketing_opt_in: boolean;
};

/** 가입·재동의 요청 본문. 필수 항목이 빠졌으면 서버 계약상 보낼 수 없어 null이다. */
export function buildConsentBody(choices: ConsentChoices, termsVersion: string): ConsentBody | null {
  if (!isConsentComplete(choices)) return null;
  return { age_confirmed: true, terms_version: termsVersion, marketing_opt_in: choices.marketingOptIn };
}

export const CONSENT_REQUIRED_MESSAGE = "만 18세 이상 확인과 현재 이용약관 동의가 필요합니다. 항목을 다시 확인해 주세요.";
export const INVALID_SIGNUP_TOKEN_MESSAGE = "가입 요청이 만료되었거나 이미 사용되었습니다. 소셜 로그인부터 다시 시작해 주세요.";

const CONSENT_ERROR_MESSAGES: Record<string, string> = {
  CONSENT_REQUIRED: CONSENT_REQUIRED_MESSAGE,
  INVALID_SIGNUP_TOKEN: INVALID_SIGNUP_TOKEN_MESSAGE
};

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** 동의 관련 실패를 서버 error.code 기준으로 안내한다. 모르는 code면 에러 메시지, 없으면 fallback. */
export function consentErrorMessage(error: unknown, fallback: string): string {
  const code = errorCode(error);
  if (code && CONSENT_ERROR_MESSAGES[code]) return CONSENT_ERROR_MESSAGES[code];
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 소셜 가입 토큰이 만료·사용돼 소셜 로그인부터 다시 해야 하는 실패인지. */
export function isSignupTokenInvalid(error: unknown): boolean {
  return errorCode(error) === "INVALID_SIGNUP_TOKEN";
}

/**
 * 동의 화면에 머무는 사이 같은 이메일로 다른 가입이 끝나 거절된 409 EMAIL_REGISTERED인지.
 * 토큰이 소비되므로 다시 보낼 수 없고, 기존 계정으로 로그인한 뒤 설정에서 연동한다.
 */
export function isSignupEmailRegistered(error: unknown): boolean {
  return errorCode(error) === "EMAIL_REGISTERED";
}

/** 토큰이 소비돼 이 동의 화면에서는 더 진행할 수 없는 실패(만료·사용됨, 같은 이메일의 계정 있음). */
export function isSignupTokenConsumed(error: unknown): boolean {
  return isSignupTokenInvalid(error) || isSignupEmailRegistered(error);
}

/** OAuth 콜백 주소에 붙어 온 소셜 신규 가입 토큰. 기존 회원 로그인(code)·실패(error)면 null이다. */
export function parseOAuthSignupToken(params: Pick<URLSearchParams, "get">): string | null {
  return params.get("signup_token") || null;
}

/** 로그인 응답·GET /api/auth/me의 consent_required가 참이면 재동의 화면을 거친다. */
export function needsReconsent(user: { consent_required?: boolean } | null | undefined): boolean {
  return user?.consent_required === true;
}
