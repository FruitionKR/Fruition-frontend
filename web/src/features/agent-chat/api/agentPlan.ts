import { apiFetch, idempotentJsonHeaders, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { AgentPlan, AgentPlanRun } from "../lib/agentPlan";

const TURN_CANCEL_STATUSES = new Set(["cancel_requested", "rolling_back", "rollback_failed", "cancelled"]);

/** 채팅의 turn ID와 실제 승인 대상 run ID는 서로 다르다. */
export async function fetchAgentPlanRun(workspaceId: string, turnId: string, signal?: AbortSignal): Promise<AgentPlanRun | null> {
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
  const runResponse = await apiFetch(workspacePath(workspaceId, "agent", "runs", turn.result.run_id), { cache: "no-store", signal });
  return parseJsonOrThrow<AgentPlanRun>(runResponse, "작업 계획을 불러오지 못했습니다.");
}

export async function decideAgentPlan(workspaceId: string, runId: string, decision: "approve" | "reject", plan: AgentPlan): Promise<AgentPlanRun> {
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId, decision), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    ...(decision === "approve" ? { body: JSON.stringify({ plan_version: plan.version, operation_hash: plan.operation_hash }) } : {})
  });
  return parseJsonOrThrow<AgentPlanRun>(response, "계획 승인·거절을 처리하지 못했습니다. 최신 상태를 확인해주세요.");
}
