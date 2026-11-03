import type { AnalyticsEvents } from "@/shared/lib/analytics/events";
import { AgentTurnLostError } from "@/features/agent-chat/lib/turnFollow";

type AiTaskFailed = AnalyticsEvents["ai_task_failed"];

/** fetch가 응답 없이 실패했을 때(연결 끊김) 던지는 오류. 서버가 응답한 오류(ApiError)·취소(AbortError)와 구분한다. */
function isUnreachedRequest(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * 작업 turn 실패 중 서버가 모르는 경우만 ai_task_failed 속성으로 바꾼다. 나머지는 null(서버가 보내거나 보내지 않는 실패).
 * - 응답 없음으로 확정(AgentTurnLostError): timeout
 * - 턴 요청이 서버에 닿지 않음(turn ID가 없음): result. 서버 ID가 없어 이 요청의 클라이언트 ID를 쓴다.
 */
export function agentTurnFailure(
  error: unknown,
  { turnId, clientTaskId }: { turnId: string | null; clientTaskId: string }
): AiTaskFailed | null {
  if (error instanceof AgentTurnLostError && turnId) {
    return { task_id: turnId, task_kind: "agent_turn", stage: "timeout", failure_reason: "timeout" };
  }
  if (!turnId && isUnreachedRequest(error)) {
    return { task_id: clientTaskId, task_kind: "agent_turn", stage: "result", failure_reason: "unknown" };
  }
  return null;
}

/** AI 초안 새 문서 생성 요청이 서버에 닿지 않은 실패. task_id는 그 초안을 만든 agent run ID다. */
export function markdownCreateFailure(error: unknown, runId: string): AiTaskFailed | null {
  if (!isUnreachedRequest(error)) return null;
  return { task_id: runId, task_kind: "agent_turn", stage: "apply", failure_reason: "unknown", action: "markdown_create" };
}

/** 같은 task_id는 한 번만 보낸다(다시 확인으로 같은 turn을 또 놓쳐도 1회). */
export function createAiTaskFailureReporter(capture: (properties: AiTaskFailed) => void) {
  const sent = new Set<string>();
  return (properties: AiTaskFailed | null) => {
    if (!properties || sent.has(properties.task_id)) return;
    sent.add(properties.task_id);
    capture(properties);
  };
}
