/**
 * 계정에 저장한 언어(GET /api/auth/me의 locale)와 이 브라우저의 언어 쿠키를 맞추는 판정.
 * - 이 브라우저에서 직접 고른 언어(fruition.locale)가 있으면 그 값이 우선이다. 서버 값과 다르면 서버에 맞춘다(push).
 * - 직접 고른 적이 없고 서버에 값이 있으면 서버 값을 화면에 적용한다(adopt). 자동 판정 쿠키에 남겨 다른 기기의 선택을 계속 따른다.
 * - locale 필드가 없는 구 서버면 아무것도 하지 않는다(쿠키만 쓰는 기존 동작).
 */
import { AUTO_LOCALE_COOKIE, AUTO_LOCALE_MAX_AGE_SECONDS, LOCALE_COOKIE, LOCALE_MAX_AGE_SECONDS, parseLocale, type Locale } from "@/shared/i18n/locale";

/** 사용자가 언어를 고르면 useChangeLocale이 보내는 이벤트(detail: Locale). 로그인 상태면 계정에도 저장한다. */
export const LOCALE_CHOSEN_EVENT = "fruition:locale-chosen";

export type LocaleSyncAction =
  | { readonly type: "none" }
  | { readonly type: "adopt"; readonly locale: Locale }
  | { readonly type: "push"; readonly locale: Locale };

/** 서버가 언어 저장을 지원하는지. 구 서버의 MeResponse에는 locale 필드가 없다(undefined). null은 "아직 저장 안 함"이다. */
export function supportsAccountLocale(me: { readonly locale?: unknown } | null | undefined): boolean {
  return Boolean(me) && me?.locale !== undefined;
}

export function decideLocaleSync(input: { readonly serverLocale: unknown; readonly chosenLocale: unknown }): LocaleSyncAction {
  if (input.serverLocale === undefined) return { type: "none" };
  const server = parseLocale(input.serverLocale);
  const chosen = parseLocale(input.chosenLocale);
  if (chosen) return chosen === server ? { type: "none" } : { type: "push", locale: chosen };
  return server ? { type: "adopt", locale: server } : { type: "none" };
}

/** 언어를 고른 뒤 계정에 저장할지. 로그인해 me를 받았고, 서버가 지원하며, 값이 다를 때만 PATCH한다. */
export function shouldSaveChosenLocale(me: { readonly locale?: unknown } | null | undefined, chosen: Locale): boolean {
  return supportsAccountLocale(me) && parseLocale(me?.locale) !== chosen;
}

function writeCookie(name: string, value: Locale, maxAge: number): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/** 사용자가 이 브라우저에서 직접 고른 언어. */
export function writeChosenLocaleCookie(locale: Locale): void {
  writeCookie(LOCALE_COOKIE, locale, LOCALE_MAX_AGE_SECONDS);
}

/** 계정에서 가져온 언어. 직접 고른 값이 아니라 자동 판정 쿠키에 둔다. */
export function writeAutoLocaleCookie(locale: Locale): void {
  writeCookie(AUTO_LOCALE_COOKIE, locale, AUTO_LOCALE_MAX_AGE_SECONDS);
}
