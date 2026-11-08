/**
 * API 요청에 화면 언어를 `Accept-Language`로 싣는다. access·document는 이 값으로 오류 message를 고르고,
 * document는 AI에 response_language로 넘겨 채팅·에이전트 답변 언어를 맞춘다.
 * 브라우저가 붙이는 기본 Accept-Language는 OS·브라우저 언어라 화면에서 고른 언어와 다를 수 있어 직접 덮어쓴다.
 * Accept-Language는 CORS-safelisted 헤더(값 `ko`·`en`)라 직접 접속(NEXT_PUBLIC_DOCUMENT_DIRECT_API) 경로에서도 preflight 허용 목록이 필요 없다.
 */
import { AUTO_LOCALE_COOKIE, LOCALE_COOKIE, parseLocale, type Locale } from "@/shared/i18n/locale";

export const ACCEPT_LANGUAGE_HEADER = "Accept-Language";

/** `document.cookie` 형식 문자열에서 쿠키 하나를 읽는다. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

/**
 * 요청에 실을 언어. 미들웨어와 같은 순서(직접 고른 언어 → 자동 판정)로 쿠키를 보고,
 * 쿠키를 못 읽으면 서버가 그린 `<html lang>`을 쓴다. 어느 것도 없으면 null(헤더를 바꾸지 않는다).
 */
export function resolveRequestLocale(input: { cookie?: string | null; documentLang?: string | null }): Locale | null {
  return (
    parseLocale(readCookie(input.cookie, LOCALE_COOKIE)) ??
    parseLocale(readCookie(input.cookie, AUTO_LOCALE_COOKIE)) ??
    parseLocale(input.documentLang)
  );
}

/** 호출부가 Accept-Language를 직접 정했으면 그대로 두고, 아니면 화면 언어를 넣은 새 Headers를 돌려준다. */
export function withLocaleHeader(headersInit: HeadersInit | undefined, locale: Locale | null): Headers {
  const headers = new Headers(headersInit);
  if (locale && !headers.has(ACCEPT_LANGUAGE_HEADER)) headers.set(ACCEPT_LANGUAGE_HEADER, locale);
  return headers;
}

/** 브라우저에서 지금 화면 언어. 서버 렌더·테스트(Node)에서는 null. */
export function currentRequestLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  return resolveRequestLocale({ cookie: document.cookie, documentLang: document.documentElement?.lang });
}

/** 토큰 없이 직접 부르는 API(로그인·가입·초대 등)용 fetch. 화면 언어만 더한다. */
export function localizedFetch(input: string, init?: RequestInit): Promise<Response> {
  const locale = currentRequestLocale();
  return locale ? fetch(input, { ...init, headers: withLocaleHeader(init?.headers, locale) }) : fetch(input, init);
}
