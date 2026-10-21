"use client";

import { useEffect } from "react";
import { FAVICON_DARK_QUERY, watchFaviconScheme } from "@/shared/lib/favicon";

/**
 * 탭 아이콘을 OS·브라우저 색 구성에 맞춘다(app/layout.tsx의 link[data-favicon]).
 * 첫 화면은 link의 media로 고르고, hydration 뒤부터는 색 구성이 바뀔 때마다 href를 바로 바꾼다.
 */
export function FaviconSync() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    return watchFaviconScheme(
      window.matchMedia(FAVICON_DARK_QUERY),
      () => document.querySelectorAll<HTMLLinkElement>("link[data-favicon]")
    );
  }, []);
  return null;
}
