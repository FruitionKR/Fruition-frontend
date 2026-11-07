"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { LOCALES, type Locale } from "@/shared/i18n/locale";
import { useChangeLocale } from "@/shared/i18n/useChangeLocale";
import styles from "./ThemeSwitch.module.css";

/** 버튼에 보이는 짧은 표기. 언어 이름은 그 언어로 읽히도록 lang을 붙인다. */
const SHORT_LABELS: Readonly<Record<Locale, string>> = { ko: "KO", en: "EN" };

/**
 * 랜딩 헤더의 언어 선택(한국어 · English). 테마 선택과 같은 세그먼트 모양이고, 고르면 쿠키에 남긴 뒤
 * 서버 컴포넌트를 다시 그려 새로고침 없이 바뀐다. 좁은 화면에서는 헤더 메뉴 안에 같은 컴포넌트를 둔다.
 */
export function LanguageSwitch() {
  const t = useTranslations("common.language");
  const { locale, changeLocale, isChanging } = useChangeLocale();
  const groupName = useId();

  return (
    <fieldset className={styles["theme-switch"]} aria-busy={isChanging || undefined}>
      <legend className={styles["sr-only"]}>{t("label")}</legend>
      {LOCALES.map((option) => (
        <label key={option} className={styles["option"]} data-text title={t(option)} lang={option}>
          <input
            type="radio"
            name={groupName}
            value={option}
            checked={locale === option}
            onChange={() => changeLocale(option)}
          />
          <span aria-hidden="true">{SHORT_LABELS[option]}</span>
          <span className={styles["sr-only"]}>{t(option)}</span>
        </label>
      ))}
    </fieldset>
  );
}
