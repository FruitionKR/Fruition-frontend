"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { type Locale } from "./locale";
import { LOCALE_CHOSEN_EVENT, writeChosenLocaleCookie } from "./localeSync";

/**
 * 사용자가 고른 언어를 쿠키에 남기고 서버 컴포넌트를 다시 그려 바로 반영한다(새로고침 없음).
 * 로그인 상태면 AccountLocaleSync가 LOCALE_CHOSEN_EVENT를 받아 계정에도 저장한다(실패해도 화면 전환은 유지).
 */
export function useChangeLocale(): { locale: Locale; changeLocale: (next: Locale) => void; isChanging: boolean } {
  const router = useRouter();
  const locale = useLocale();
  const [isChanging, startTransition] = useTransition();

  function changeLocale(next: Locale) {
    if (next === locale) return;
    writeChosenLocaleCookie(next);
    window.dispatchEvent(new CustomEvent<Locale>(LOCALE_CHOSEN_EVENT, { detail: next }));
    startTransition(() => router.refresh());
  }

  return { locale, changeLocale, isChanging };
}
