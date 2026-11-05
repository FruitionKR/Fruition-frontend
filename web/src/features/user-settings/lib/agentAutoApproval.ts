import type { UserPreferences } from "@/entities/user/model/preferences";

/** 서버(document-svc) 계약: 사용자 단위 AI 에이전트 계획 자동 승인 설정. 기본값은 모두 꺼짐(매번 승인). */
export type AgentAutoApprovalSettings = {
  content_edit: boolean;
  organize: boolean;
};

export type AgentAutoApprovalKey = keyof AgentAutoApprovalSettings;

export const DEFAULT_AGENT_AUTO_APPROVAL: AgentAutoApprovalSettings = { content_edit: false, organize: false };

export const AGENT_AUTO_APPROVAL_QUERY_KEY = ["agentAutoApproval"] as const;

/** 켤 때 띄우는 경고. 무엇이 확인 없이 바뀌는지와 되돌리는 방법을 적는다. */
export type AutoApprovalWarning = { title: string; description: string; confirmLabel: string };

export type AgentAutoApprovalCategory = {
  key: AgentAutoApprovalKey;
  label: string;
  /** 무엇이 확인 없이 바뀌는지와 되돌리는 방법 */
  description: string;
  confirmOnEnable: AutoApprovalWarning;
};

/** 서버 설정이 아니라 사용자 기본 설정에 두는 자동 처리. 서버 계획을 거치지 않는 AI 결과의 확인 단계다. */
export type ClientAutoApprovalKey = "autoSaveMeetingNotes" | "autoPublishSkillDrafts";

export type ClientAutoApprovalCategory = Omit<AgentAutoApprovalCategory, "key"> & {
  key: ClientAutoApprovalKey & keyof UserPreferences;
};

/** 설정 화면에 보일 분류. 위험이 낮은 것부터 둔다. 여기 없는 작업(삭제 등)은 항상 직접 승인한다. */
export const AGENT_AUTO_APPROVAL_CATEGORIES: readonly AgentAutoApprovalCategory[] = [
  {
    key: "organize",
    label: "폴더 생성·이동·이름 변경",
    description: "AI가 제안한 폴더 만들기, 문서·폴더 옮기기, 이름 바꾸기를 확인 없이 실행합니다. 내용은 바뀌지 않고, 다시 옮기거나 이름을 바꿔 되돌릴 수 있습니다.",
    confirmOnEnable: {
      title: "폴더 정리를 자동 승인할까요?",
      description: "AI가 제안한 폴더 만들기, 문서·폴더 옮기기, 이름 바꾸기가 확인 없이 바로 실행됩니다. 함께 쓰는 사람의 문서 목록에도 바로 반영됩니다. 되돌리려면 문서 목록에서 직접 다시 옮기거나 이름을 바꿔야 합니다.",
      confirmLabel: "자동 승인 켜기"
    }
  },
  {
    key: "content_edit",
    label: "문서 편집·생성",
    description: "AI가 제안한 문서 본문 수정과 새 문서 만들기를 확인 없이 실행합니다. 수정은 로그 화면에서 롤백하고(그 뒤에 고친 내용도 함께 되돌아갑니다), 새 문서는 휴지통으로 옮겨 되돌릴 수 있습니다.",
    confirmOnEnable: {
      title: "문서 편집·생성을 자동 승인할까요?",
      description: "AI가 제안한 수정이 미리 보기 없이 문서 본문에 바로 저장되고, 새 문서 초안은 확인 없이 문서로 만들어집니다. 함께 편집하는 사람에게도 바뀐 내용이 보입니다. 수정은 로그 화면에서 그 작업을 롤백해 되돌리는데, 그 뒤에 고친 내용도 함께 되돌아갑니다. 새 문서는 휴지통으로 옮기면 됩니다.",
      confirmLabel: "자동 승인 켜기"
    }
  }
];

export const CLIENT_AUTO_APPROVAL_CATEGORIES: readonly ClientAutoApprovalCategory[] = [
  {
    key: "autoSaveMeetingNotes",
    label: "회의록 새 문서로 저장",
    description: "AI가 회의록을 다 만들면 확인 없이 새 문서로 저장합니다. 필요 없으면 휴지통으로 옮겨 되돌릴 수 있습니다.",
    confirmOnEnable: {
      title: "회의록을 자동으로 저장할까요?",
      description: "AI가 만든 회의록을 읽어 보기 전에 확인 없이 새 문서로 저장합니다. 열린 문서에는 추가하지 않습니다. 저장된 문서는 권한에 따라 다른 사람에게도 보일 수 있습니다. 필요 없으면 그 문서를 휴지통으로 옮기면 됩니다.",
      confirmLabel: "자동 저장 켜기"
    }
  },
  {
    key: "autoPublishSkillDrafts",
    label: "AI 스킬 초안 게시",
    description: "스킬 만들기에서 AI가 작성한 초안이 안전 검토를 통과하면 확인 없이 게시합니다. 게시한 스킬은 스킬 화면에서 지울 수 있습니다.",
    confirmOnEnable: {
      title: "AI 스킬 초안을 자동으로 게시할까요?",
      description: "'AI로 작성·보강'의 결과가 안전 검토를 통과하면 확인 없이 스킬이 바로 게시됩니다. 저장 범위를 팀으로 골랐으면 워크스페이스 구성원도 바로 쓸 수 있습니다. 되돌리려면 스킬 화면에서 그 스킬을 지우면 됩니다.",
      confirmLabel: "자동 게시 켜기"
    }
  }
];

/** 항상 직접 확인해야 하는 경우 안내. 서버 정책(AgentAutoApprovalPolicy)과 편집안 자동 적용 판단(resolveTurnAutoApply)을 그대로 옮겼다. */
export const AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE =
  "켜 두어도 AI 검토 경고(중복 의심 등)가 있거나 기본 선택에서 빠진 항목이 있는 계획, 내가 편집할 권한이 없는 문서·폴더가 포함된 계획, 위 분류에 없는 작업은 직접 승인해야 합니다. 문서 편집안도 요청한 뒤 문서가 바뀌었거나, 지금 편집할 수 없거나, AI가 요청한 범위를 넓혔거나, 이 설정을 불러오지 못하면 확인 화면으로 보여 줍니다. 회의록을 열린 문서 끝에 추가하는 작업과 안전 검토에 걸린 스킬 초안도 직접 확인합니다. 회의록·스킬 초안 설정은 이 브라우저에만 적용됩니다.";

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
