/**
 * 재발급까지 실패해 세션이 끝났음을 나타낸다.
 * 안내 문구는 언제든 바뀔 수 있으므로 제어 흐름은 문자열 비교가 아니라 이 타입으로 판단한다.
 */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/**
 * HTTP 실패 응답. message는 기존처럼 사람이 읽을 문구이고, 분기는 status와 서버 code(error.code)로 한다.
 * Error를 상속하므로 message만 보던 호출부는 그대로 동작한다.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** 같은 이메일의 계정이 이미 있어 가입이 거절된 409의 서버 code(access #31). */
export const EMAIL_REGISTERED_ERROR_CODES = ["EMAIL_REGISTERED_WITH_OAUTH", "EMAIL_REGISTERED"] as const;

/**
 * 같은 이메일의 계정이 이미 있어 두 번째 가입을 막은 409.
 * providers는 그 계정의 로그인 수단(이메일 가입은 "local", 소셜은 provider 이름)이라 화면이 "그 방법으로 로그인한 뒤 연동"을 안내한다.
 * 인증번호 요청·이메일 가입은 EMAIL_REGISTERED_WITH_OAUTH(oauth_providers), 소셜 가입 동의는 EMAIL_REGISTERED(providers)로 온다.
 */
export class EmailRegisteredError extends ApiError {
  readonly providers: readonly string[];

  constructor(message: string, status: number, code: string, providers: readonly string[]) {
    super(message, status, code);
    this.name = "EmailRegisteredError";
    this.providers = providers;
  }
}

/** 크레딧 부족 거절(402 INSUFFICIENT_CREDIT) 안내. 결제가 없어 충전 대신 문의를 안내한다(#153). */
export const INSUFFICIENT_CREDIT_MESSAGE = "크레딧이 부족합니다.";

/** 서버가 크레딧 부족으로 AI 작업을 시작하지 않은 거절(document #122). 입력·파일은 지우지 않고 다시 시도할 수 있게 둔다. */
export function isInsufficientCreditError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402 && error.code === "INSUFFICIENT_CREDIT";
}

/**
 * unknown 에러에서 사람이 읽을 메시지를 안전하게 추출합니다.
 * Error가 아니면 fallback 문구를 반환합니다.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (isInsufficientCreditError(error)) return INSUFFICIENT_CREDIT_MESSAGE;
  if (isErrorMessage(error, "agent_not_configured")) {
    return "서버 설정으로 인해 AI 작업 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.";
  }
  if (isErrorMessage(error, "agent_turn_route_contract_failed")) {
    return "AI의 작업 분류 응답을 처리하지 못했습니다. 다시 시도해 주세요.";
  }
  return error instanceof Error ? error.message : fallback;
}

export function isErrorMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}
