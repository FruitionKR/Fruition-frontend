"use client";

import type { ReactNode } from "react";
import { useUserPreferences, type DocumentFontPreference, type MotionPreference, type UserPreferences } from "@/entities/user";
import type { ThemePreference } from "@/shared/lib/themePreference";
import { cx } from "@/shared/lib/classNames";
import { Switch } from "@/shared/ui/Switch";
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
function FontSample({ font }: { font: DocumentFontPreference }) {
  return (
    <span className={panelStyles["font-sample"]} data-document-font={font} aria-hidden>
      가나다 Aa
    </span>
  );
}

const THEME_CHOICES: Choice<ThemePreference>[] = [
  { value: "system", label: "OS에 맞춤", description: "기기의 라이트·다크 설정을 따릅니다.", preview: <ThemeSwatch theme="system" /> },
  { value: "light", label: "라이트", description: "항상 밝은 화면으로 봅니다.", preview: <ThemeSwatch theme="light" /> },
  { value: "dark", label: "다크", description: "항상 어두운 화면으로 봅니다.", preview: <ThemeSwatch theme="dark" /> }
];

const FONT_CHOICES: Choice<DocumentFontPreference>[] = [
  { value: "readable-sans", label: "Readable Sans", description: "기본 글꼴. 한글 문서를 읽기 편합니다.", preview: <FontSample font="readable-sans" /> },
  { value: "system-sans", label: "System Sans", description: "기기에 설치된 기본 글꼴을 씁니다.", preview: <FontSample font="system-sans" /> },
  { value: "serif", label: "Serif", description: "긴 글을 책처럼 읽을 때 좋습니다.", preview: <FontSample font="serif" /> }
];

const MOTION_CHOICES: Choice<MotionPreference>[] = [
  { value: "system", label: "OS에 맞춤", description: "기기의 동작 줄이기 설정을 따릅니다." },
  { value: "reduced", label: "줄이기", description: "화면 전환·펼침 애니메이션을 끕니다." },
  { value: "full", label: "그대로", description: "애니메이션을 모두 보여 줍니다." }
];

/** 같은 모양의 선택 카드 묶음(radiogroup). */
function ChoiceCards<T extends string>({ labelId, choices, value, onSelect }: {
  labelId: string;
  choices: Choice<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className={panelStyles.choices} role="radiogroup" aria-labelledby={labelId}>
      {choices.map((choice) => {
        const isSelected = value === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={cx(panelStyles.choice, isSelected && panelStyles["is-selected"])}
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

/** 기본 설정 패널: 이 계정에만 적용되는 화면·편집·채팅 설정. 워크스페이스 공용 설정은 워크스페이스 설정에 있다. */
export function PreferencesPanel() {
  const { preferences, updatePreferences } = useUserPreferences();

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    updatePreferences((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="기본 설정" description="이 계정에서 보는 화면과 편집·채팅 방식을 설정합니다." />

      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-theme-label">화면 테마</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-theme-label" choices={THEME_CHOICES} value={preferences.theme} onSelect={(theme) => update("theme", theme)} />
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-font-label">문서 글꼴</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-font-label" choices={FONT_CHOICES} value={preferences.documentFont} onSelect={(font) => update("documentFont", font)} />
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader id="preferences-motion-label">애니메이션</SettingsSectionHeader>
        <ChoiceCards labelId="preferences-motion-label" choices={MOTION_CHOICES} value={preferences.motion} onSelect={(motion) => update("motion", motion)} />
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>편집과 채팅</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>자동 저장</strong>
            <small>편집한 내용을 자동으로 저장합니다. 끄면 Cmd/Ctrl+S로 저장합니다.</small>
          </div>
          <Switch checked={preferences.autoSave} label="자동 저장" onClick={() => update("autoSave", !preferences.autoSave)} />
        </div>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>웹 검색 기본으로 켜기</strong>
            <small>채팅에서 질문할 때 웹 검색을 함께 씁니다. 채팅 모델 메뉴의 웹 서칭과 같은 설정입니다.</small>
          </div>
          <Switch checked={preferences.webSearch} label="웹 검색 기본으로 켜기" onClick={() => update("webSearch", !preferences.webSearch)} />
        </div>
      </div>
    </div>
  );
}
