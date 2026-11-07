import type { UserPreferences } from "@/entities/user/model/preferences";

/** 서버(document-svc) 계약: 사용자 단위 AI 에이전트 계획 자동 승인 설정. 기본값은 모두 꺼짐(매번 승인). */
export type AgentAutoApprovalSettings = {
  content_edit: boolean;
  organize: boolean;
};

export type AgentAutoApprovalKey = keyof AgentAutoApprovalSettings;

export const DEFAULT_AGENT_AUTO_APPROVAL: AgentAutoApprovalSettings = { content_edit: false, organize: false };

export const AGENT_AUTO_APPROVAL_QUERY_KEY = ["agentAutoApproval"] as const;

/** 서버 설정이 아니라 사용자 기본 설정에 두는 자동 처리. 서버 계획을 거치지 않는 AI 결과의 확인 단계다. */
export type ClientAutoApprovalKey = "autoSaveMeetingNotes" | "autoPublishSkillDrafts";

/**
 * 설정 화면에 보일 분류. 위험이 낮은 것부터 둔다. 여기 없는 작업(삭제 등)은 항상 직접 승인한다.
 * 이름·설명·켤 때 경고 문구와 항상 직접 확인하는 경우 안내는 settings 메시지(ai.autoApproval)에 둔다.
 * 항상 직접 확인하는 경우 안내(alwaysManualNote)는 서버 정책(AgentAutoApprovalPolicy)과 편집안 자동 적용 판단(resolveTurnAutoApply)을 그대로 옮겼다.
 */
export const AGENT_AUTO_APPROVAL_CATEGORIES: readonly AgentAutoApprovalKey[] = ["organize", "content_edit"];

export const CLIENT_AUTO_APPROVAL_CATEGORIES: readonly (ClientAutoApprovalKey & keyof UserPreferences)[] = [
  "autoSaveMeetingNotes",
  "autoPublishSkillDrafts"
];

/** 토글 결과. 켜는데 아직 경고를 확인하지 않았으면 저장하지 않고 확인을 먼저 요청한다. 끌 때는 바로 끈다. */
export function toggleAgentAutoApproval(
  settings: AgentAutoApprovalSettings,
  key: AgentAutoApprovalKey,
  confirmed = false
): { next: AgentAutoApprovalSettings; needsConfirmation: boolean } {
  const enabling = !settings[key];
  if (enabling && !confirmed) return { next: settings, needsConfirmation: true };
  return { next: { ...settings, [key]: enabling }, needsConfirmation: false };
}
