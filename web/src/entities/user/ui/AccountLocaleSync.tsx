"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { LOCALE_COOKIE, type Locale } from "@/shared/i18n/locale";
import { LOCALE_CHOSEN_EVENT, decideLocaleSync, shouldSaveChosenLocale, writeAutoLocaleCookie } from "@/shared/i18n/localeSync";
import { readCookie } from "@/shared/i18n/requestLocale";
import { isSessionExpired } from "@/shared/lib/authSessionStorage";
import { updateAccountLocale } from "../api/account";
import type { UserMeResponse } from "../model/user";
import { readCachedMe, subscribeToMeCache } from "../model/meCache";
import { ME_QUERY_KEY } from "../model/useMe";

/** 계정에 언어를 저장하고 응답(MeResponse)으로 me 캐시를 바꾼다. 실패는 조용히 넘긴다(개발 로그도 남기지 않는다). */
function saveAccountLocale(queryClient: QueryClient, locale: Locale): void {
  updateAccountLocale(locale)
    .then((updated) => queryClient.setQueryData<UserMeResponse>(ME_QUERY_KEY, updated))
    .catch(() => undefined);
}

/**
 * 계정에 저장한 언어와 이 브라우저의 언어를 맞춘다(src/shared/i18n/localeSync.ts). 화면을 그리지 않는다.
 * /api/auth/me를 직접 부르지 않고, 다른 화면이 받아 둔 me 캐시가 바뀔 때만 판정한다.
 * 저장 실패는 조용히 넘긴다. 화면 언어는 이미 쿠키로 바뀌었고 다음 me 판정에서 다시 맞춘다.
 */
export function AccountLocaleSync() {
  const router = useRouter();
  const displayedLocale = useLocale();
  const queryClient = useQueryClient();
  // useMe({ enabled: false })의 observer는 로그인 흐름의 queryClient.clear() 뒤 지워진 query에 남아 새 me를 받지 못한다.
  // queryCache를 구독해 clear 뒤 다시 받은 me로도 바로 판정한다(새로고침 없이 계정 언어 적용).
  const subscribe = useCallback((listener: () => void) => subscribeToMeCache(queryClient, listener), [queryClient]);
  const me = useSyncExternalStore(subscribe, () => readCachedMe(queryClient), () => undefined);
  // 같은 계정·언어로 PATCH를 거듭 보내지 않는다(실패했을 때 me가 바뀔 때마다 재시도하지 않게).
  const pushedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!me || isSessionExpired()) return;
    const action = decideLocaleSync({ serverLocale: me.locale, chosenLocale: readCookie(document.cookie, LOCALE_COOKIE) });
    if (action.type === "adopt") {
      writeAutoLocaleCookie(action.locale);
      if (action.locale !== displayedLocale) router.refresh();
    } else if (action.type === "push") {
      const key = `${me.id}:${action.locale}`;
      if (pushedRef.current === key) return;
      pushedRef.current = key;
      saveAccountLocale(queryClient, action.locale);
    }
  }, [me, displayedLocale, queryClient, router]);

  useEffect(() => {
    function handleChosen(event: Event) {
      const chosen = (event as CustomEvent<Locale>).detail;
      const current = queryClient.getQueryData<UserMeResponse>(ME_QUERY_KEY);
      if (!current || isSessionExpired() || !shouldSaveChosenLocale(current, chosen)) return;
      pushedRef.current = `${current.id}:${chosen}`;
      saveAccountLocale(queryClient, chosen);
    }
    window.addEventListener(LOCALE_CHOSEN_EVENT, handleChosen);
    return () => window.removeEventListener(LOCALE_CHOSEN_EVENT, handleChosen);
  }, [queryClient]);

  return null;
}
