"use client";

import { useId, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  applyThemePreference,
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference
} from "@/shared/lib/themePreference";
import styles from "./ThemeSwitch.module.css";

const OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

const preferenceListeners = new Set<() => void>();

function subscribeToPreference(listener: () => void) {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

function ThemeIcon({ value }: { value: ThemePreference }) {
  if (value === "light") {
    return (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (value === "dark") {
    return (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.8" y="2.6" width="12.4" height="8.6" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 13.6h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 랜딩 헤더의 화면 테마 선택(시스템 · 라이트 · 다크). 앱 설정과 같은 저장 키(fruition.theme)와 적용 함수를 써서
 * 로그인 전 화면에서 고른 값이 다음 첫 화면 스크립트(THEME_INIT_SCRIPT)로 깜빡임 없이 이어진다.
 * 네이티브 라디오 버튼이라 화살표 키로 고르고 Tab으로 빠져나간다.
 */
export function ThemeSwitch() {
  const t = useTranslations("landing");
  // 서버에서는 저장 값을 모르므로 시스템으로 그린 뒤, 브라우저에서 저장 값으로 맞춘다(테마 자체는 첫 화면 스크립트가 이미 적용).
  // 헤더와 휴대폰 메뉴에 하나씩 있으므로 저장 값을 함께 구독해 둘이 어긋나지 않게 한다.
  const preference = useSyncExternalStore(subscribeToPreference, readStoredPreference, () => "system" as const);
  const groupName = useId();

  const select = (value: ThemePreference) => {
    applyThemePreference(value);
    preferenceListeners.forEach((listener) => listener());
  };

  return (
    <fieldset className={styles["theme-switch"]}>
      <legend className={styles["sr-only"]}>{t("header.theme")}</legend>
      {OPTIONS.map((option) => (
        <label key={option} className={styles["option"]} title={t(`theme.${option}`)}>
          <input
            type="radio"
            name={groupName}
            value={option}
            checked={preference === option}
            onChange={() => select(option)}
          />
          <ThemeIcon value={option} />
          <span className={styles["sr-only"]}>{t(`theme.${option}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}
