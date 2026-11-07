import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { AUTO_LOCALE_COOKIE, DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, matchAcceptLanguage, parseLocale } from "./locale";
import { MESSAGES } from "./messages";

/**
 * next-intl 요청 설정(next.config.mjs의 플러그인이 이 파일을 가리킨다). URL 접두어 없이 쓰므로
 * 미들웨어가 정해 넘긴 헤더를 먼저 보고, 미들웨어를 거치지 않은 요청이면 쿠키·Accept-Language로 정한다.
 */
export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const locale =
    parseLocale(requestHeaders.get(LOCALE_HEADER)) ??
    parseLocale(cookieStore.get(LOCALE_COOKIE)?.value) ??
    parseLocale(cookieStore.get(AUTO_LOCALE_COOKIE)?.value) ??
    matchAcceptLanguage(requestHeaders.get("accept-language")) ??
    DEFAULT_LOCALE;
  // 서비스 시간대는 한국 기준이다. 날짜를 서버·브라우저가 같게 그리도록 고정한다.
  return { locale, messages: MESSAGES[locale], timeZone: "Asia/Seoul" };
});
