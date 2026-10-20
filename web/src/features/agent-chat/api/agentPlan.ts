import { apiFetch, idempotentJsonHeaders, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { AgentPlan, AgentPlanRun } from "../lib/agentPlan";
import { TURN_CANCEL_STATUSES } from "@/features/agent-chat/lib/stalledTurns";

/**
 * 채팅의 turn ID와 실제 승인 대상 run ID는 서로 다르다. knownRunId(knownPlanRunId)를 알면 turn 조회를 건너뛰고
 * 그 run만 받는다. 모르면 turn에서 run ID를 찾는다.
 */
export async function fetchAgentPlanRun(
  workspaceId: string,
  turnId: string,
  signal?: AbortSignal,
  knownRunId?: string | null
): Promise<AgentPlanRun | null> {
  if (knownRunId) return fetchRun(workspaceId, knownRunId, signal);
  const response = await apiFetch(workspacePath(workspaceId, "agent", "turn", turnId), { cache: "no-store", signal });
  const turn = await parseJsonOrThrow<{
    status: string;
    result: { run_id?: string | null } | null;
    error_code?: string | null;
  }>(response, "작업 계획을 불러오지 못했습니다.");
  if (turn.status === "failed") throw new Error("계획 생성 요청이 실패했습니다.");
  // 문서 삭제 등으로 turn이 취소되면 run 없이 turn 상태만 온다. 취소 중은 폴링을 이어 가고, 종결(취소됨·복구 실패)은 폴링을 멈춘다(#141).
  if (TURN_CANCEL_STATUSES.has(turn.status)) {
    return { id: turnId, status: turn.status, plan: null, error_code: turn.error_code ?? null };
  }
  if (turn.status !== "completed") return null;
  if (!turn.result?.run_id) throw new Error("이 답변의 계획 정보를 찾을 수 없습니다. 다시 요청해주세요.");
  return fetchRun(workspaceId, turn.result.run_id, signal);
}

async function fetchRun(workspaceId: string, runId: string, signal?: AbortSignal): Promise<AgentPlanRun> {
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId), { cache: "no-store", signal });
  return parseJsonOrThrow<AgentPlanRun>(response, "작업 계획을 불러오지 못했습니다.");
}

const INVALID_SELECTION_MESSAGE = "고른 항목을 적용할 수 없습니다. 함께 적용해야 하는 항목이 빠졌거나 계획이 바뀌었을 수 있어요. 선택을 확인한 뒤 다시 적용해주세요.";

/**
 * 승인·거절. operationIds를 주면 그 작업만 실행하는 부분 승인이다(생략하면 계획 전체).
 * 부분 승인이어도 plan_version·operation_hash는 계획 전체 기준이다.
 */
export async function decideAgentPlan(
  workspaceId: string,
  runId: string,
  decision: "approve" | "reject",
  plan: AgentPlan,
  operationIds?: readonly string[] | null
): Promise<AgentPlanRun> {
  const approval = { plan_version: plan.version, operation_hash: plan.operation_hash, ...(operationIds ? { operation_ids: operationIds } : {}) };
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId, decision), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    ...(decision === "approve" ? { body: JSON.stringify(approval) } : {})
  });
  // 400: operation_ids 중복·계획에 없는 ID·고르지 않은 작업에 의존하는 작업을 고름(AI 계약).
  if (decision === "approve" && operationIds && response.status === 400) throw new Error(INVALID_SELECTION_MESSAGE);
  return parseJsonOrThrow<AgentPlanRun>(response, "계획 승인·거절을 처리하지 못했습니다. 최신 상태를 확인해주세요.");
}
