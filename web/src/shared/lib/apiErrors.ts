/** 로그인 전 요청의 인증 거절. 세션 만료 알림 없이 로그인 화면으로 안내한다. */
export class LoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

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

/** 워크스페이스의 채팅 세션 한도를 넘긴 409. 서버 문구에는 내부 워크스페이스 ID가 들어 있어 그대로 보여 주지 않는다. */
export const CHAT_SESSION_LIMIT_MESSAGE = "대화는 워크스페이스마다 10개까지 둘 수 있어요. 대화 목록의 ⋮ 메뉴에서 안 쓰는 대화를 지우면 새 대화를 시작할 수 있어요.";

export function isChatSessionLimitError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "CHAT_SESSION_LIMIT_EXCEEDED";
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

/** AI 사용량 한도 초과(429)의 서버 code. 하루 토큰 한도(limit_type DAILY_TOKENS)에 걸리면 온다. */
export const AI_USAGE_LIMIT_EXCEEDED_CODE = "AI_USAGE_LIMIT_EXCEEDED";
export const AI_DAILY_LIMIT_MESSAGE = "오늘 사용할 수 있는 AI 사용량을 모두 썼어요. 내일 다시 이용해 주세요.";

/** 업로드 제한 거절 code별 안내. 한도 값은 서버 설정이라 문구에 숫자를 넣지 않는다. */
export const UPLOAD_LIMIT_MESSAGES = {
  FILE_TOO_LARGE: "파일이 너무 커서 올릴 수 없어요. 더 작은 파일로 다시 올려 주세요.",
  TOO_MANY_FILES: "한 번에 올릴 수 있는 파일 수를 넘었어요. 나눠서 다시 올려 주세요.",
  STORAGE_QUOTA_EXCEEDED: "내 저장 공간을 모두 사용했어요. 사용하지 않는 문서를 삭제한 뒤 다시 올려 주세요.",
  UPLOAD_DAILY_LIMIT_EXCEEDED: "오늘 올릴 수 있는 파일 수를 넘었어요. 내일 다시 올려 주세요."
} as const;

/** 서버 error 본문에서 함께 오는 한도 정보. snake_case(document 서비스 관례)와 camelCase를 모두 받는다. */
export type UsageLimitDetail = { limit_type?: unknown; limitType?: unknown; reset_at?: unknown; resetAt?: unknown };

const SEOUL = "Asia/Seoul";

/** 한국 시간 기준 날짜·시각 조각. 한도 초기화는 서버가 Asia/Seoul 0시로 정한다. */
function seoulParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}

/**
 * 초기화 시각 문구(한국 시간). 다음 날 0시면 "내일(11월 3일) 0시", 다른 날 0시면 "11월 5일 0시",
 * 그 밖에는 "11월 3일 오후 3:00"이다. 잘못된 값이면 null.
 */
export function formatResetTime(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const reset = seoulParts(date);
  const dayLabel = `${reset.month}월 ${reset.day}일`;
  if (reset.hour === 0 && reset.minute === 0) {
    const today = seoulParts(now);
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    const isTomorrow = reset.year === tomorrow.getUTCFullYear() && reset.month === tomorrow.getUTCMonth() + 1 && reset.day === tomorrow.getUTCDate();
    return isTomorrow ? `내일(${dayLabel}) 0시` : `${dayLabel} 0시`;
  }
  const time = date.toLocaleTimeString("ko-KR", { timeZone: SEOUL, hour: "numeric", minute: "2-digit" });
  return `${dayLabel} ${time}`;
}

/**
 * AI 사용량 한도 안내. 서버 한도는 하루 토큰뿐이라 limit_type과 관계없이(모르는 값·없음 포함) 하루 한도 안내다.
 * 초기화 시각이 오면 "내일" 대신 그 시각을 알려 준다.
 */
export function aiUsageLimitMessage(detail?: UsageLimitDetail | null, now: Date = new Date()): string {
  const resetAt = formatResetTime(detail?.reset_at ?? detail?.resetAt, now);
  if (!resetAt) return AI_DAILY_LIMIT_MESSAGE;
  return `오늘 사용할 수 있는 AI 사용량을 모두 썼어요. ${resetAt}부터 다시 이용할 수 있어요.`;
}

/** 사용량·업로드 제한 code면 화면 안내 문구를, 아니면 null을 돌려준다. parseApiError가 서버 문구 대신 쓴다. */
export function usageLimitMessage(code: string | undefined, detail?: UsageLimitDetail | null): string | null {
  if (!code) return null;
  if (code === AI_USAGE_LIMIT_EXCEEDED_CODE) return aiUsageLimitMessage(detail);
  return (UPLOAD_LIMIT_MESSAGES as Record<string, string>)[code] ?? null;
}

/** AI 사용량 한도로 거절됐는지. 다시 조회해도 결과가 바뀌지 않으므로 재시도하지 않는다. */
export function isAiUsageLimitError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === AI_USAGE_LIMIT_EXCEEDED_CODE;
}

export const REQUEST_TIMEOUT_MESSAGE = "응답이 너무 오래 걸려 확인을 멈췄어요. 잠시 뒤 다시 시도해 주세요.";
export const REQUEST_ABORTED_MESSAGE = "요청이 중단됐어요. 다시 시도해 주세요.";
export const CONNECTION_LOST_MESSAGE = "서버와 연결이 끊겨 응답을 받지 못했어요. 다시 시도해 주세요.";
/**
 * 404 WORKSPACE_NOT_FOUND 안내. 서버 문구("…: id=ws_…")는 id를 그대로 담는다.
 * 멤버가 아니거나(내보내짐·삭제) OWNER 전용 변경을 멤버가 요청해도 같은 코드라 둘 다 맞는 문구로 쓴다.
 */
export const WORKSPACE_NOT_FOUND_MESSAGE = "워크스페이스를 찾을 수 없거나 접근 권한이 없어요.";

/**
 * 브라우저가 만든 영어 연결 오류(AbortSignal.timeout의 "signal timed out", fetch 중단·네트워크 끊김)를 한국어 안내로 바꾼다.
 * 연결 오류가 아니면 null.
 */
export function connectionErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error) && !(typeof DOMException !== "undefined" && error instanceof DOMException)) return null;
  const { name, message } = error as Error;
  if (name === "TimeoutError" || /signal timed out/i.test(message)) return REQUEST_TIMEOUT_MESSAGE;
  if (name === "AbortError" || /(operation|signal) (was|is) aborted|BodyStreamBuffer was aborted/i.test(message)) return REQUEST_ABORTED_MESSAGE;
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed|network error|network connection was lost|terminated/i.test(message)) {
    return CONNECTION_LOST_MESSAGE;
  }
  return null;
}

/**
 * unknown 에러에서 사람이 읽을 메시지를 안전하게 추출합니다.
 * Error가 아니면 fallback 문구를 반환합니다.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (isChatSessionLimitError(error)) return CHAT_SESSION_LIMIT_MESSAGE;
  if (isInsufficientCreditError(error)) return INSUFFICIENT_CREDIT_MESSAGE;
  if (isWorkspacePermissionRequiredError(error)) return workspacePermissionRequiredMessage(error);
  if (isErrorMessage(error, "agent_not_configured")) {
    return "서버 설정으로 인해 AI 작업 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.";
  }
  if (isErrorMessage(error, "agent_turn_route_contract_failed")) {
    return "AI의 작업 분류 응답을 처리하지 못했습니다. 다시 시도해 주세요.";
  }
  if (error instanceof ApiError && error.status === 404 && error.code === "WORKSPACE_NOT_FOUND") return WORKSPACE_NOT_FOUND_MESSAGE;
  const connectionMessage = connectionErrorMessage(error);
  if (connectionMessage) return connectionMessage;
  return error instanceof Error ? error.message : fallback;
}

export function isErrorMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}
