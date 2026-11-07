/**
 * 화면 언어(로케일) 결정. URL 접두어 없이 쿠키로만 언어를 기억한다.
 * 우선순위: 사용자가 고른 언어(쿠키) → 지난번 자동 판정(쿠키) → IP 국가(한국이면 ko, 그 밖은 en)
 *         → Accept-Language → 기본 ko.
 * 미들웨어·서버 렌더·테스트가 함께 쓰도록 Next·브라우저 API에 기대지 않는 순수 함수로 둔다.
 */

export const LOCALES = ["ko", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ko";

/** 사용자가 직접 고른 언어. 이 값만 "고정"으로 본다. */
export const LOCALE_COOKIE = "fruition.locale";
/** IP·Accept-Language로 정한 언어를 다시 판정하지 않도록 잠시 남겨 두는 쿠키. 사용자 선택이 아니다. */
export const AUTO_LOCALE_COOKIE = "fruition.locale-auto";
export const AUTO_LOCALE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const LOCALE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** 미들웨어가 정한 언어를 서버 렌더에 넘기는 요청 헤더. 첫 요청은 응답 쿠키가 아직 요청에 없어서 필요하다. */
export const LOCALE_HEADER = "x-fruition-locale";

export type LocaleSource = "user" | "auto" | "ip" | "accept-language" | "default";

export interface LocaleDecision {
  readonly locale: Locale;
  readonly source: LocaleSource;
}

export function parseLocale(value: unknown): Locale | null {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

/** Accept-Language에서 q값이 가장 높은 지원 언어. 지원 언어가 없으면 null. */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { language: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((candidate) => candidate.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return candidates.map((candidate) => parseLocale(candidate.language)).find((locale) => locale !== null) ?? null;
}

/** ALB가 붙인 X-Forwarded-For의 첫 값(원래 클라이언트). 언어 판정에만 쓰므로 위조돼도 영향이 화면 언어뿐이다. */
export function clientIpFromForwardedFor(header: string | null | undefined): string | null {
  const first = header?.split(",")[0]?.trim();
  return first ? first : null;
}

export interface LocaleInput {
  readonly userLocale?: string | null;
  readonly autoLocale?: string | null;
  readonly ip?: string | null;
  readonly acceptLanguage?: string | null;
  /** IP가 한국 대역인지. 사설·해석 불가 주소는 null을 돌려준다. */
  readonly isKoreanIp: (ip: string) => boolean | null;
}

export function decideLocale({ userLocale, autoLocale, ip, acceptLanguage, isKoreanIp }: LocaleInput): LocaleDecision {
  const chosen = parseLocale(userLocale);
  if (chosen) return { locale: chosen, source: "user" };
  const remembered = parseLocale(autoLocale);
  if (remembered) return { locale: remembered, source: "auto" };
  const korean = ip ? isKoreanIp(ip) : null;
  if (korean !== null) return { locale: korean ? "ko" : "en", source: "ip" };
  const accepted = matchAcceptLanguage(acceptLanguage);
  if (accepted) return { locale: accepted, source: "accept-language" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}

/** 새로 판정한 결과만 자동 판정 쿠키로 남긴다(사용자 선택·이미 남긴 값은 다시 쓰지 않는다). */
export function shouldRememberDecision(decision: LocaleDecision): boolean {
  return decision.source === "ip" || decision.source === "accept-language" || decision.source === "default";
}
