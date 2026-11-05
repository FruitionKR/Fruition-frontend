"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserPreferences } from "@/entities/user";
import { useSelectedWorkspace } from "@/entities/workspace";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { Switch } from "@/shared/ui/Switch";
import { saveAgentAutoApproval } from "../../api/agentAutoApproval";
import {
  AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE,
  AGENT_AUTO_APPROVAL_CATEGORIES,
  AGENT_AUTO_APPROVAL_QUERY_KEY,
  CLIENT_AUTO_APPROVAL_CATEGORIES,
  DEFAULT_AGENT_AUTO_APPROVAL,
  toggleAgentAutoApproval,
  type AgentAutoApprovalKey,
  type AutoApprovalWarning,
  type ClientAutoApprovalKey
} from "../../lib/agentAutoApproval";
import { useAgentAutoApprovalSettings } from "../../model/useAgentAutoApprovalSettings";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

/**
 * AI 자동 승인: 켠 분류의 AI 작업은 확인 없이 실행된다. 켤 때는 무엇이 바뀌는지 경고하고, 끌 때는 바로 끈다.
 * 서버 계획 분류(organize·content_edit)의 판단과 권한 검사는 서버가 한다. 설정은 계정 단위(모든 워크스페이스 공통)다.
 */
export function AgentAutoApprovalSection() {
  const workspace = useSelectedWorkspace();
  const client = useQueryClient();
  const { preferences, updatePreferences } = useUserPreferences();
  const [confirming, setConfirming] = useState<{ warning: AutoApprovalWarning; onConfirm: () => void } | null>(null);
  const settings = useAgentAutoApprovalSettings();
  const save = useMutation({
    mutationFn: (next: typeof DEFAULT_AGENT_AUTO_APPROVAL) => saveAgentAutoApproval(workspace!.id, next),
    onSuccess: (saved) => client.setQueryData(AGENT_AUTO_APPROVAL_QUERY_KEY, saved)
  });
  const current = settings.data ?? DEFAULT_AGENT_AUTO_APPROVAL;
  const disabled = !settings.data || save.isPending;

  function toggleServerSetting(key: AgentAutoApprovalKey, warning: AutoApprovalWarning) {
    const { next, needsConfirmation } = toggleAgentAutoApproval(current, key);
    if (needsConfirmation) {
      setConfirming({ warning, onConfirm: () => save.mutate(toggleAgentAutoApproval(current, key, true).next) });
      return;
    }
    save.mutate(next);
  }

  function setClientSetting(key: ClientAutoApprovalKey, value: boolean) {
    updatePreferences((previous) => ({ ...previous, [key]: value }));
  }

  function toggleClientSetting(key: ClientAutoApprovalKey, warning: AutoApprovalWarning) {
    if (preferences[key]) {
      setClientSetting(key, false);
      return;
    }
    setConfirming({ warning, onConfirm: () => setClientSetting(key, true) });
  }

  const error = settings.error ?? save.error;
  return (
    <div className={styles.section}>
      <SettingsSectionHeader>AI 에이전트 자동 승인</SettingsSectionHeader>
      {AGENT_AUTO_APPROVAL_CATEGORIES.map((category) => (
        <div key={category.key} className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{category.label}</strong>
            <small>{category.description}</small>
          </div>
          <Switch
            checked={current[category.key]}
            disabled={disabled}
            label={`${category.label} 자동 승인`}
            onClick={() => toggleServerSetting(category.key, category.confirmOnEnable)}
          />
        </div>
      ))}
      {CLIENT_AUTO_APPROVAL_CATEGORIES.map((category) => (
        <div key={category.key} className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{category.label}</strong>
            <small>{category.description}</small>
          </div>
          <Switch
            checked={preferences[category.key]}
            label={`${category.label} 자동 승인`}
            onClick={() => toggleClientSetting(category.key, category.confirmOnEnable)}
          />
        </div>
      ))}
      <div className={styles["row-title"]}>
        <small>{AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE}</small>
        {error && <small className={styles["row-error"]} role="alert">{getErrorMessage(error, "자동 승인 설정을 처리하지 못했습니다.")}</small>}
      </div>
      {confirming && (
        <ConfirmModal
          titleId="agent-auto-approval-confirm-title"
          title={confirming.warning.title}
          description={confirming.warning.description}
          confirmLabel={confirming.warning.confirmLabel}
          tone="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            confirming.onConfirm();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
