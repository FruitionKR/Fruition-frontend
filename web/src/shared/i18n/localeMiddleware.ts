import type { NextRequest, NextResponse } from "next/server";
import { isKoreanIp } from "./ipCountry";
import {
  AUTO_LOCALE_COOKIE,
  AUTO_LOCALE_MAX_AGE_SECONDS,
  LOCALE_COOKIE,
  clientIpFromForwardedFor,
  decideLocale,
  shouldRememberDecision,
  type LocaleDecision
} from "./locale";

/** 화면 요청의 언어를 정한다. 루트 middleware.ts에서 호출한다. */
export function decideRequestLocale(request: NextRequest): LocaleDecision {
  return decideLocale({
    userLocale: request.cookies.get(LOCALE_COOKIE)?.value,
    autoLocale: request.cookies.get(AUTO_LOCALE_COOKIE)?.value,
    ip: clientIpFromForwardedFor(request.headers.get("x-forwarded-for")),
    acceptLanguage: request.headers.get("accept-language"),
    isKoreanIp
  });
}

/** 새로 판정한 언어를 자동 판정 쿠키로 남겨 다음 요청부터 다시 판정하지 않는다. */
export function rememberLocaleDecision(response: NextResponse, decision: LocaleDecision): NextResponse {
  if (!shouldRememberDecision(decision)) return response;
  response.cookies.set(AUTO_LOCALE_COOKIE, decision.locale, {
    path: "/",
    maxAge: AUTO_LOCALE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
