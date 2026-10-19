// 소셜 계정 연동(설정 > 계정)과 소셜 가입 이메일 안내에 쓰는 순수 로직.
// node:test에서 별칭 없이 쓰기 위해 shared를 import하지 않고, 서버 error.code와 providers 필드로만 판단한다.

/** 간편 로그인 버튼과 같은 순서. 화면에 보일 이름을 함께 둔다. */
export const OAUTH_PROVIDER_OPTIONS = [
  { provider: "kakao", name: "카카오" },
  { provider: "naver", name: "네이버" },
  { provider: "google", name: "Google" }
] as const;

export function oauthProviderName(provider: string): string {
  return OAUTH_PROVIDER_OPTIONS.find((option) => option.provider === provider)?.name ?? provider;
}

/** OAuth 콜백 주소에 붙어 온 연동 결과. 일반 로그인 콜백(code/error)이면 null이다. */
export type OAuthLinkCallback = { kind: "confirm"; linkCode: string } | { kind: "failed" };

export function parseOAuthLinkCallback(params: Pick<URLSearchParams, "get">): OAuthLinkCallback | null {
  const linkCode = params.get("link_code");
  if (linkCode) return { kind: "confirm", linkCode };
  if (params.get("link") === "failed") return { kind: "failed" };
  return null;
}

export const OAUTH_LINK_SUCCESS_MESSAGE = "소셜 계정을 연동했습니다.";
export const OAUTH_LINK_FAILED_MESSAGE = "소셜 계정 인증에 실패했습니다. 다시 시도해 주세요.";

const OAUTH_ACCOUNT_ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_OAUTH_PROVIDER: "지원하지 않는 로그인 서비스입니다.",
  INVALID_OAUTH_LINK_CODE: "연동 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.",
  OAUTH_ACCOUNT_ALREADY_LINKED: "이미 다른 계정에 연결된 소셜 계정이거나, 같은 서비스의 다른 계정이 이미 연결되어 있습니다.",
  OAUTH_ACCOUNT_NOT_FOUND: "연결되지 않은 소셜 계정입니다.",
  OAUTH_UNLINK_NOT_ALLOWED: "가입할 때 사용한 소셜 계정은 연동을 해제할 수 없습니다."
};

/** 연동·해제 실패를 서버 error.code 기준으로 안내한다. 모르는 code면 에러 메시지, 없으면 fallback. */
export function oauthAccountErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && OAUTH_ACCOUNT_ERROR_MESSAGES[code]) return OAUTH_ACCOUNT_ERROR_MESSAGES[code];
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 이메일 가입 계정의 로그인 수단. 서버가 소셜 provider와 같은 목록에 이 이름으로 넣어 준다. */
const LOCAL_PROVIDER = "local";
const LINK_GUIDE = "설정 > 계정 보안에서 연동해 주세요.";
/** providers가 비어 온 비정상 응답에도 두 번째 가입 대신 로그인·연동을 안내한다. */
const REGISTERED_EMAIL_FALLBACK_MESSAGE = `이미 가입된 이메일입니다. 기존 방법으로 로그인한 뒤 ${LINK_GUIDE}`;

/**
 * 같은 이메일의 계정이 이미 있어 가입이 막혔을 때, 그 계정의 로그인 수단으로 로그인한 뒤 설정에서 연동하도록 안내한다(access #31).
 * local(이메일 가입)이 있으면 이메일 로그인을, 아니면 소셜 provider 로그인을 안내한다. 목록이 비어 있으면 null.
 */
export function registeredEmailLoginMessage(providers: readonly string[]): string | null {
  if (providers.length === 0) return null;
  if (providers.includes(LOCAL_PROVIDER)) {
    return `이미 이메일로 가입된 이메일입니다. 이메일과 비밀번호로 로그인한 뒤 ${LINK_GUIDE}`;
  }
  const names = providers.map(oauthProviderName).join(", ");
  return `이미 ${names}로 가입된 이메일입니다. ${names}로 로그인한 뒤 ${LINK_GUIDE}`;
}

/** 같은 이메일의 소셜 가입 계정이 있으면 이메일 가입을 막고 그 소셜 로그인으로 안내한다. 없으면 null. */
export function signupOAuthConflictMessage(providers: readonly string[]): string | null {
  return registeredEmailLoginMessage(providers.filter((provider) => provider !== LOCAL_PROVIDER));
}

export const DUPLICATE_EMAIL_MESSAGE = "이미 가입된 이메일입니다.";

/**
 * 가입 화면의 이메일 중복 확인 결과 안내. 소셜 가입 계정이 있으면 available 값과 무관하게 그 소셜 로그인 안내가 먼저고,
 * 그다음 이메일 가입 계정 중복, 가입할 수 있으면 null.
 */
export function signupAvailabilityMessage(availability: { available: boolean; oauth_providers?: readonly string[] }): string | null {
  return signupOAuthConflictMessage(availability.oauth_providers ?? []) ?? (availability.available ? null : DUPLICATE_EMAIL_MESSAGE);
}

const EMAIL_REGISTERED_CODES = ["EMAIL_REGISTERED_WITH_OAUTH", "EMAIL_REGISTERED"];

/**
 * 서버가 같은 이메일의 계정으로 가입을 거절한 409(EMAIL_REGISTERED_WITH_OAUTH·EMAIL_REGISTERED)면 로그인·연동 안내, 아니면 null.
 * parseApiError가 만든 EmailRegisteredError(code·providers)를 받는다.
 */
export function registeredEmailErrorMessage(error: unknown): string | null {
  const { code, providers } = (error as { code?: unknown; providers?: unknown } | null) ?? {};
  if (typeof code !== "string" || !EMAIL_REGISTERED_CODES.includes(code)) return null;
  const list = Array.isArray(providers) ? providers.filter((item): item is string => typeof item === "string") : [];
  return registeredEmailLoginMessage(list) ?? REGISTERED_EMAIL_FALLBACK_MESSAGE;
}

/** OAuth 콜백 주소에 붙어 온 실패. 같은 이메일의 계정이 있어 가입이 거절됐으면 그 계정의 로그인 수단을 함께 준다. */
export type OAuthCallbackError = { kind: "email_registered"; providers: string[] } | { kind: "failed" };

export function parseOAuthCallbackError(params: Pick<URLSearchParams, "get">): OAuthCallbackError | null {
  const error = params.get("error");
  if (!error) return null;
  if (error !== "email_registered") return { kind: "failed" };
  const providers = (params.get("providers") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return { kind: "email_registered", providers };
}

export const OAUTH_LOGIN_FAILED_MESSAGE = "간편 로그인에 실패했습니다.";

export function oauthCallbackErrorMessage(callbackError: OAuthCallbackError): string {
  if (callbackError.kind === "email_registered") {
    return registeredEmailLoginMessage(callbackError.providers) ?? REGISTERED_EMAIL_FALLBACK_MESSAGE;
  }
  return OAUTH_LOGIN_FAILED_MESSAGE;
}

/** 소셜 연동 해제 안내. 해제한 소셜 계정으로 다시 로그인해도 두 번째 계정이 생기지 않는다(access #31). */
export const OAUTH_UNLINK_GUIDE = "연동을 해제한 소셜 계정으로 다시 로그인해도 새 계정이 만들어지지 않고, 이메일로 로그인한 뒤 여기서 다시 연동하도록 안내됩니다.";

/** 연동 콜백에서 설정 화면으로 돌아갈 때 결과를 넘기는 sessionStorage 항목. */
const OAUTH_LINK_RESULT_STORAGE_KEY = "fruition.oauth_link_result";

export type OAuthLinkResult = { ok: boolean; message: string };
type ResultStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): ResultStorage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function saveOAuthLinkResult(result: OAuthLinkResult, storage = defaultStorage()) {
  storage?.setItem(OAUTH_LINK_RESULT_STORAGE_KEY, JSON.stringify(result));
}

export function hasOAuthLinkResult(storage = defaultStorage()): boolean {
  return Boolean(storage?.getItem(OAUTH_LINK_RESULT_STORAGE_KEY));
}

/** 남겨 둔 연동 결과를 한 번만 읽는다. 형식이 맞지 않으면 버린다. */
export function takeOAuthLinkResult(storage = defaultStorage()): OAuthLinkResult | null {
  const raw = storage?.getItem(OAUTH_LINK_RESULT_STORAGE_KEY);
  if (!raw) return null;
  storage?.removeItem(OAUTH_LINK_RESULT_STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthLinkResult>;
    return typeof parsed.ok === "boolean" && typeof parsed.message === "string"
      ? { ok: parsed.ok, message: parsed.message }
      : null;
  } catch {
    return null;
  }
}
