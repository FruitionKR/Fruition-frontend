"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMe, useUserPreferences, type DocumentFontPreference, type MotionPreference, type UserPreferences } from "@/entities/user";
import type { ThemePreference } from "@/shared/lib/themePreference";
import { cx } from "@/shared/lib/classNames";
import { useChangeLocale } from "@/shared/i18n/useChangeLocale";
import { LOCALES, type Locale } from "@/shared/i18n/locale";
import { supportsAccountLocale } from "@/shared/i18n/localeSync";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import panelStyles from "./PreferencesPanel.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

type Choice<T extends string> = { value: T; label: string; description: string; preview?: ReactNode };

/** 견본: 위 막대(제목)와 아래 두 줄(본문). OS에 맞춤은 왼쪽 라이트·오른쪽 다크로 나눠 보여 준다. */
function ThemeSwatch({ theme }: { theme: ThemePreference }) {
  return (
    <span className={cx(panelStyles.swatch, panelStyles[`swatch-${theme}`])} aria-hidden>
      <span className={panelStyles["swatch-bar"]} />
      <span className={panelStyles["swatch-line"]} />
      <span className={cx(panelStyles["swatch-line"], panelStyles["is-short"])} />
    </span>
  );
}

/** 글꼴 견본: 그 글꼴로 쓴 한글·영문 (base.css [data-document-font] 토큰을 그대로 쓴다). */
function FontSample({ font, sample }: { font: DocumentFontPreference; sample: string }) {
  return (
    <span className={panelStyles["font-sample"]} data-document-font={font} aria-hidden>
      {sample}
    </span>
  );
}

const THEME_VALUES: readonly ThemePreference[] = ["system", "light", "dark"];
const FONT_CHOICES: ReadonlyArray<{ value: DocumentFontPreference; label: string; descriptionKey: "readableSans" | "systemSans" | "serif" }> = [
  { value: "readable-sans", label: "Readable Sans", descriptionKey: "readableSans" },
  { value: "system-sans", label: "System Sans", descriptionKey: "systemSans" },
  { value: "serif", label: "Serif", descriptionKey: "serif" }
];
const MOTION_VALUES: readonly MotionPreference[] = ["system", "reduced", "full"];

/** 같은 모양의 선택 카드 묶음(radiogroup). */
function ChoiceCards<T extends string>({ labelId, choices, value, disabled = false, onSelect }: {
  labelId: string;
  choices: Choice<T>[];
  value: T;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className={panelStyles.choices} role="radiogroup" aria-labelledby={labelId} aria-busy={disabled || undefined}>
      {choices.map((choice) => {
        const isSelected = value === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={cx(panelStyles.choice, isSelected && panelStyles["is-selected"])}
            disabled={disabled}
            onClick={() => onSelect(choice.value)}
          >
            {choice.preview}
            <span className={panelStyles["choice-text"]}>
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 디스플레이 설정: 이 계정에만 적용되는 화면 설정. 시안(SNB 1577:3515)은 메뉴 이름만 있어 기존 구성을 유지한다.
 * 자동 저장은 시안대로 워크스페이스 설정 화면으로, 채팅 웹 검색·에이전트 자동 승인은 AI 설정으로 옮겼다.
 */
export function PreferencesPanel() {
  const t = useTranslations("settings.preferences");
  const tLanguage = useTranslations("common.language");
  const { preferences, updatePreferences } = useUserPreferences();
  const { locale, changeLocale, isChanging } = useChangeLocale();
  const { data: me } = useMe();

  // 언어 이름은 지금 화면 언어와 관계없이 각 언어 원문(한국어·English)으로 보여 준다(그 언어를 읽는 사람이 찾을 수 있게).
  const languageChoices: Choice<Locale>[] = LOCALES.map((value) => ({
    value,
    label: tLanguage(value),
    description: t(value === "ko" ? "language.koDescription" : "language.enDescription")
  }));
  const themeChoices: Choice<ThemePreference>[] = THEME_VALUES.map((value) => ({
    value, label: t(`theme.${value}.label`), description: t(`theme.${value}.description`), preview: <ThemeSwatch theme={value} />
  }));
  const fontChoices: Choice<DocumentFontPreference>[] = FONT_CHOICES.map(({ value, label, descriptionKey }) => ({
    value, label, description: t(`font.${descriptionKey}`), preview: <FontSample font={value} sample={t("font.sample")} />
  }));
  const motionChoices: Choice<MotionPreference>[] = MOTION_VALUES.map((value) => ({
    value, label: t(`motion.${value}.label`), description: t(`motion.${value}.description`)
  }));

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    updatePreferences((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title={t("title")} description={t("description")} />

      {/* 언어 저장을 지원하는 서버면 계정에도 저장하고(AccountLocaleSync), 구 서버면 쿠키(이 브라우저)에만 남는다. */}
      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-language-label">{tLanguage("label")}</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-language-label" choices={languageChoices} value={locale} disabled={isChanging} onSelect={changeLocale} />
        <small className={styles["status-text"]}>{supportsAccountLocale(me) ? t("language.accountNote") : t("language.note")}</small>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-theme-label">{t("theme.label")}</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-theme-label" choices={themeChoices} value={preferences.theme} onSelect={(theme) => update("theme", theme)} />
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-font-label">{t("font.label")}</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-font-label" choices={fontChoices} value={preferences.documentFont} onSelect={(font) => update("documentFont", font)} />
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-motion-label">{t("motion.label")}</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-motion-label" choices={motionChoices} value={preferences.motion} onSelect={(motion) => update("motion", motion)} />
      </div>
    </div>
  );
}
