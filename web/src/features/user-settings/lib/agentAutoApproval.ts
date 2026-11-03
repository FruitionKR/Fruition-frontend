/** 서버(document-svc) 계약: 사용자 단위 AI 에이전트 계획 자동 승인 설정. 기본값은 모두 꺼짐(매번 승인). */
export type AgentAutoApprovalSettings = {
  content_edit: boolean;
  organize: boolean;
};

export type AgentAutoApprovalKey = keyof AgentAutoApprovalSettings;

export const DEFAULT_AGENT_AUTO_APPROVAL: AgentAutoApprovalSettings = { content_edit: false, organize: false };

export type AgentAutoApprovalCategory = {
  key: AgentAutoApprovalKey;
  label: string;
  /** 무엇이 확인 없이 바뀌는지와 되돌리는 방법 */
  description: string;
  /** 켤 때 한 번 더 확인받는다. 문서 본문이 확인 없이 바뀌는 분류다. */
  confirmOnEnable: null | { title: string; description: string; confirmLabel: string };
};

/** 설정 화면에 보일 분류. 위험이 낮은 것부터 둔다. 여기 없는 작업(삭제 등)은 항상 직접 승인한다. */
export const AGENT_AUTO_APPROVAL_CATEGORIES: readonly AgentAutoApprovalCategory[] = [
  {
    key: "organize",
    label: "폴더 생성·이동·이름 변경",
    description: "AI가 제안한 폴더 만들기, 문서·폴더 옮기기, 이름 바꾸기를 확인 없이 실행합니다. 내용은 바뀌지 않고, 다시 옮기거나 이름을 바꿔 되돌릴 수 있습니다.",
    confirmOnEnable: null
  },
  {
    key: "content_edit",
    label: "문서 편집·생성",
    description: "AI가 제안한 문서 본문 수정과 새 문서 만들기를 확인 없이 실행합니다. 편집 전 내용은 버전 기록에서 복원할 수 있습니다.",
    confirmOnEnable: {
      title: "문서 편집·생성을 자동 승인할까요?",
      description: "AI가 제안한 수정이 미리 보기 없이 문서 본문에 바로 저장됩니다. 함께 편집하는 사람에게도 바뀐 내용이 보입니다. 잘못 바뀐 내용은 버전 기록에서 복원해야 합니다.",
      confirmLabel: "자동 승인 켜기"
    }
  }
];

/** 항상 직접 승인해야 하는 작업 안내. 서버가 분류 밖 작업을 자동 승인하지 않는다. */
export const AGENT_AUTO_APPROVAL_ALWAYS_MANUAL_NOTE =
  "켜 두어도 AI 검토 경고(중복 의심 등)가 있는 계획, 내가 편집할 권한이 없는 문서·폴더가 포함된 계획, 삭제처럼 위 분류에 없는 작업은 지금처럼 직접 승인해야 합니다.";

/** 토글 결과. 켜는데 추가 확인이 필요한 분류면 저장하지 않고 확인을 먼저 요청한다. */
export function toggleAgentAutoApproval(
  settings: AgentAutoApprovalSettings,
  key: AgentAutoApprovalKey,
  confirmed = false
): { next: AgentAutoApprovalSettings; needsConfirmation: boolean } {
  const enabling = !settings[key];
  const category = AGENT_AUTO_APPROVAL_CATEGORIES.find((item) => item.key === key);
  if (enabling && category?.confirmOnEnable && !confirmed) return { next: settings, needsConfirmation: true };
  return { next: { ...settings, [key]: enabling }, needsConfirmation: false };
}
