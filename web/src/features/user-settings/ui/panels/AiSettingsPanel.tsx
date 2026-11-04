"use client";

import { useUserPreferences } from "@/entities/user";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import { AgentAutoApprovalSection } from "./AgentAutoApprovalSection";
import { AiUsageSection } from "./AiUsageSection";

/**
 * AI 설정: 이 계정에 적용되는 AI 옵션(채팅 웹 검색·에이전트 자동 승인)과 AI 사용량.
 * 시안에 없는 메뉴라 디스플레이 설정과 사용자 설정에 있던 항목을 같은 섹션 머리말·간격으로 모았다.
 */
export function AiSettingsPanel() {
  const { preferences, updatePreferences } = useUserPreferences();

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="AI 설정" description="내 계정에서 쓰는 AI 기능과 사용량을 관리합니다." />

      <div className={styles.section}>
        <SettingsSectionHeader>채팅</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>웹 검색 기본으로 켜기</strong>
            <small>채팅에서 질문할 때 웹 검색을 함께 씁니다.</small>
          </div>
          <Switch
            checked={preferences.webSearch}
            label="웹 검색 기본으로 켜기"
            onClick={() => updatePreferences((current) => ({ ...current, webSearch: !current.webSearch }))}
          />
        </div>
      </div>

      <AgentAutoApprovalSection />

      <AiUsageSection />
    </div>
  );
}
