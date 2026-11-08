import type { AgentChatTranslator } from "@/features/agent-chat/lib/agentChatTranslator";

/**
 * 스킬 화면에서 '다음'을 누른 뒤 아직 보내지 못한 스킬 실행의 카드 문구. 세션·모델·문서가 준비되기를 기다리거나
 * 앞선 작업에 막혀 있어도 아무것도 안 보이는 채 기다리지 않게 이유를 적는다. 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */
export type SkillRunWaitingState = {
  label: string;
  /** 응답을 받지 못한 앞선 작업에 막혀 있어 '앞선 작업 닫고 실행'으로 풀 수 있는지 */
  canReleaseBlocking: boolean;
};

export function skillRunWaitingState({
  stalledTurnCount,
  hasBlockingPending,
  isQueryLoading,
  isAgentBusy,
  isWaitingForDocument
}: {
  /** 응답을 받지 못한 앞선 작업 수 */
  stalledTurnCount: number;
  /** 서버 기록에 아직 끝나지 않은 작업이 있는지(닫은 작업 제외) */
  hasBlockingPending: boolean;
  /** 채팅 질의 답변을 기다리는 중인지 */
  isQueryLoading: boolean;
  /** 새 문서 만들기 등 이 화면의 다른 작업이 진행 중인지 */
  isAgentBusy: boolean;
  /** 대상 문서를 열어 편집 문맥이 들어오기를 기다리는지 */
  isWaitingForDocument: boolean;
}, t: AgentChatTranslator): SkillRunWaitingState {
  if (stalledTurnCount > 0) {
    return { label: t("skillRun.waiting.stalled"), canReleaseBlocking: true };
  }
  if (hasBlockingPending || isAgentBusy) return { label: t("skillRun.waiting.blocked"), canReleaseBlocking: false };
  if (isQueryLoading) return { label: t("skillRun.waiting.query"), canReleaseBlocking: false };
  if (isWaitingForDocument) return { label: t("skillRun.waiting.document"), canReleaseBlocking: false };
  return { label: t("skillRun.waiting.preparing"), canReleaseBlocking: false };
}
