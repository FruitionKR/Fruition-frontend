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

/**
 * 워크스페이스 멤버 권한 항목(access #32)의 화면 라벨. 값 순서가 설정 화면의 표시 순서다.
 * 이 파일은 테스트가 hook 없이 직접 import하므로 다른 모듈을 import하지 않는다(카탈로그는 workspacePermissions.ts).
 */
export const WORKSPACE_PERMISSION_LABELS = {
  "wiki.ingest": "위키 편입",
  "wiki.lint": "위키 최신화",
  "skill.author": "스킬 작성",
  "wiki.restore": "작업 되돌리기",
  "document.convert": "PDF 변환"
} as const;

export type WorkspacePermission = keyof typeof WORKSPACE_PERMISSION_LABELS;

/** 권한 값의 화면 라벨. 서버가 새 값을 보내면 값을 그대로 보여 준다. */
export function workspacePermissionLabel(value: string): string {
  return (WORKSPACE_PERMISSION_LABELS as Record<string, string>)[value] ?? value;
}

/**
 * 403 WORKSPACE_PERMISSION_REQUIRED 메시지에서 필요한 권한 값을 찾는다(document #116은 `'wiki.ingest'`처럼 따옴표로 싼다).
 * 못 찾으면 null이다.
 */
export function findRequiredPermission(message: string): WorkspacePermission | null {
  return (Object.keys(WORKSPACE_PERMISSION_LABELS) as WorkspacePermission[]).find((value) => message.includes(value)) ?? null;
}

/** 워크스페이스 권한 항목이 없어 거절된 403의 서버 code(document #116). */
export const WORKSPACE_PERMISSION_REQUIRED_CODE = "WORKSPACE_PERMISSION_REQUIRED";

/** 편입·lint·변환·되돌리기·팀 스킬에 필요한 권한 항목이 없어 서버가 거절한 403인지. */
export function isWorkspacePermissionRequiredError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && error.code === WORKSPACE_PERMISSION_REQUIRED_CODE;
}

/**
 * 403 WORKSPACE_PERMISSION_REQUIRED 안내 문구. 서버 메시지에 필요한 항목(`'wiki.ingest'`)이 있으면 라벨로 보여 주고,
 * 권한은 OWNER만 부여할 수 있으므로 OWNER에게 요청하도록 안내한다.
 */
export function workspacePermissionRequiredMessage(error: ApiError): string {
  const required = findRequiredPermission(error.message);
  const subject = required ? `'${workspacePermissionLabel(required)}' 권한이` : "권한이";
  return `이 작업에는 ${subject} 필요합니다. 워크스페이스 OWNER에게 권한을 요청하세요.`;
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
  if (isWorkspacePermissionRequiredError(error)) return workspacePermissionRequiredMessage(error);
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
