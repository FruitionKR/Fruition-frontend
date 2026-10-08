// 소셜 계정 연동(설정 > 계정)과 소셜 가입 이메일 안내에 쓰는 순수 로직.

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

/** 이메일 가입 시 같은 이메일의 소셜 가입 계정이 있으면 기존 계정 연동을 안내한다. 가입은 막지 않는다. */
export function signupOAuthHint(providers: readonly string[]): string | null {
  if (providers.length === 0) return null;
  const names = providers.map(oauthProviderName).join(", ");
  return `이 이메일은 ${names}로 가입된 계정이 있습니다. 기존 계정으로 로그인한 뒤 설정에서 연동하세요. 새 계정을 만들려면 인증 요청을 한 번 더 눌러 주세요.`;
}

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
