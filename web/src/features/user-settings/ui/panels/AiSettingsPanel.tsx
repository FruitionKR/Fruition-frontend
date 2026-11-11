"use client";

import { useTranslations } from "next-intl";
import { useUserPreferences } from "@/entities/user";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import { AgentAutoApprovalSection } from "./AgentAutoApprovalSection";
import { AiCreditSection } from "./AiCreditSection";
import { AiUsageSection } from "./AiUsageSection";

/**
 * AI 설정: 이 계정에 적용되는 AI 옵션(채팅 웹 검색·에이전트 자동 승인)과 크레딧·AI 사용량.
 * 시안에 없는 메뉴라 디스플레이 설정과 사용자 설정에 있던 항목을 같은 섹션 머리말·간격으로 모았다.
 */
export function AiSettingsPanel() {
  const t = useTranslations("settings.ai");
  const { preferences, updatePreferences } = useUserPreferences();

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title={t("title")} description={t("description")} />

      <div className={styles.section}>
        <SettingsSectionHeader>{t("chatSection")}</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{t("webSearch.label")}</strong>
            <small>{t("webSearch.description")}</small>
          </div>
          <Switch
            checked={preferences.webSearch}
            label={t("webSearch.label")}
            onClick={() => updatePreferences((current) => ({ ...current, webSearch: !current.webSearch }))}
          />
        </div>
      </div>

      <AgentAutoApprovalSection />

      <AiCreditSection />

      <AiUsageSection />
    </div>
  );
}
