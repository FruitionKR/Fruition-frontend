"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelectedWorkspace } from "@/entities/workspace";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { Switch } from "@/shared/ui/Switch";
import { fetchAgentAutoApproval, saveAgentAutoApproval } from "../../api/agentAutoApproval";
import {
  AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE,
  AGENT_AUTO_APPROVAL_CATEGORIES,
  DEFAULT_AGENT_AUTO_APPROVAL,
  toggleAgentAutoApproval,
  type AgentAutoApprovalCategory,
  type AgentAutoApprovalKey
} from "../../lib/agentAutoApproval";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

const QUERY_KEY = ["agentAutoApproval"] as const;

/**
 * AI 에이전트 자동 승인: 켠 분류의 계획은 승인 확인 없이 실행된다. 판단과 권한 검사는 서버가 한다.
 * 설정은 계정 단위(모든 워크스페이스 공통)라 조회 경로의 워크스페이스는 지금 고른 것을 쓴다.
 */
export function AgentAutoApprovalSection() {
  const workspace = useSelectedWorkspace();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState<AgentAutoApprovalCategory | null>(null);
  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchAgentAutoApproval(workspace!.id),
    enabled: Boolean(workspace),
    retry: false
  });
  const save = useMutation({
    mutationFn: (next: typeof DEFAULT_AGENT_AUTO_APPROVAL) => saveAgentAutoApproval(workspace!.id, next),
    onSuccess: (saved) => client.setQueryData(QUERY_KEY, saved)
  });
  const current = settings.data ?? DEFAULT_AGENT_AUTO_APPROVAL;
  const disabled = !settings.data || save.isPending;

  function toggle(key: AgentAutoApprovalKey, confirmed = false) {
    const { next, needsConfirmation } = toggleAgentAutoApproval(current, key, confirmed);
    if (needsConfirmation) {
      setConfirming(AGENT_AUTO_APPROVAL_CATEGORIES.find((category) => category.key === key) ?? null);
      return;
    }
    save.mutate(next);
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
            onClick={() => toggle(category.key)}
          />
        </div>
      ))}
      <div className={styles["row-title"]}>
        <small>{AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE}</small>
        {error && <small className={styles["row-error"]} role="alert">{getErrorMessage(error, "자동 승인 설정을 처리하지 못했습니다.")}</small>}
      </div>
      {confirming?.confirmOnEnable && (
        <ConfirmModal
          titleId="agent-auto-approval-confirm-title"
          title={confirming.confirmOnEnable.title}
          description={confirming.confirmOnEnable.description}
          confirmLabel={confirming.confirmOnEnable.confirmLabel}
          tone="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const key = confirming.key;
            setConfirming(null);
            toggle(key, true);
          }}
        />
      )}
    </div>
  );
}
