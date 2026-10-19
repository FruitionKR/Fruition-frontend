"use client";

import { useEffect, useState } from "react";
import {
  applyThemePreference,
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference
} from "@/shared/lib/themePreference";
import styles from "./ThemeSwitch.module.css";

const OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "시스템 설정" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" }
];

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
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
  const [preference, setPreference] = useState<ThemePreference>("system");

  // 서버에서는 저장 값을 모르므로 시스템으로 그린 뒤, 브라우저에서 저장 값으로 맞춘다(테마 자체는 첫 화면 스크립트가 이미 적용).
  useEffect(() => {
    setPreference(readStoredPreference());
  }, []);

  const select = (value: ThemePreference) => {
    setPreference(value);
    applyThemePreference(value);
  };

  return (
    <fieldset className={styles["theme-switch"]}>
      <legend className={styles["sr-only"]}>화면 테마</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className={styles["option"]} title={option.label}>
          <input
            type="radio"
            name="landing-theme"
            value={option.value}
            checked={preference === option.value}
            onChange={() => select(option.value)}
          />
          <ThemeIcon value={option.value} />
          <span className={styles["sr-only"]}>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
