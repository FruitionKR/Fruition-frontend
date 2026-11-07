"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALE_COOKIE, LOCALE_MAX_AGE_SECONDS, type Locale } from "./locale";

/**
 * 사용자가 고른 언어를 쿠키에 남기고 서버 컴포넌트를 다시 그려 바로 반영한다(새로고침 없음).
 * 사용자별 서버 저장 API가 없어 이 브라우저에만 기억된다.
 */
export function useChangeLocale(): { locale: Locale; changeLocale: (next: Locale) => void; isChanging: boolean } {
  const router = useRouter();
  const locale = useLocale();
  const [isChanging, startTransition] = useTransition();

  function changeLocale(next: Locale) {
    if (next === locale) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
    startTransition(() => router.refresh());
  }

  return { locale, changeLocale, isChanging };
}
