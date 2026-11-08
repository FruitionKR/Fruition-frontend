import { apiFetch, idempotentJsonHeaders, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import { withRollbackPurgedOperations, type AgentPlan, type AgentPlanRun, type McpPriceSnapshot } from "@/features/agent-chat/lib/agentPlan";
import { parseAgentRunEditPreviews, type AgentRunEditPreviews } from "@/features/agent-chat/lib/documentEditPreviews";
import { TURN_CANCEL_STATUSES } from "@/features/agent-chat/lib/stalledTurns";
import { AgentChatError } from "../lib/agentChatError";

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
  if (knownRunId) return fetchAgentPlanRunById(workspaceId, knownRunId, signal);
  const response = await apiFetch(workspacePath(workspaceId, "agent", "turn", turnId), { cache: "no-store", signal });
  const turn = await parseJsonOrThrow<{
    status: string;
    result: { run_id?: string | null } | null;
    /** 실패 코드. run 조회와 달리 turn 조회의 코드 필드는 error다(document AgentTurnResponse). */
    error?: string | null;
  }>(response, "작업 계획을 불러오지 못했습니다.");
  if (turn.status === "failed") throw new AgentChatError("planRequestFailed", "계획 생성 요청이 실패했습니다.");
  // 문서 삭제 등으로 turn이 취소되면 run 없이 turn 상태만 온다. 취소 중은 폴링을 이어 가고, 종결(취소됨·복구 실패)은 폴링을 멈춘다(#141).
  if (TURN_CANCEL_STATUSES.has(turn.status)) {
    return { id: turnId, status: turn.status, plan: null, error_code: turn.error ?? null };
  }
  if (turn.status !== "completed") return null;
  if (!turn.result?.run_id) throw new AgentChatError("planMissing", "이 답변의 계획 정보를 찾을 수 없습니다. 다시 요청해주세요.");
  return fetchAgentPlanRunById(workspaceId, turn.result.run_id, signal);
}

export async function fetchAgentPlanRunById(workspaceId: string, runId: string, signal?: AbortSignal): Promise<AgentPlanRun> {
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId), { cache: "no-store", signal });
  return withRollbackPurgedOperations(await parseJsonOrThrow<AgentPlanRun>(response, "작업 계획을 불러오지 못했습니다."));
}

/** 문서 수정 계획의 문서별 변경 내용. 구 서버·만료면 404다. */
export async function fetchAgentRunEditPreviews(workspaceId: string, runId: string, signal?: AbortSignal): Promise<AgentRunEditPreviews> {
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId, "edit-previews"), { cache: "no-store", signal });
  return parseAgentRunEditPreviews(await parseJsonOrThrow<unknown>(response, "변경 내용을 불러오지 못했습니다."));
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
  operationIds?: readonly string[] | null,
  expectedPriceSnapshot?: McpPriceSnapshot | null
): Promise<AgentPlanRun> {
  const approval = {
    plan_version: plan.version,
    operation_hash: plan.operation_hash,
    ...(operationIds ? { operation_ids: operationIds } : {}),
    ...(expectedPriceSnapshot ? { expected_price_snapshot: expectedPriceSnapshot } : {})
  };
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId, decision), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    ...(decision === "approve" ? { body: JSON.stringify(approval) } : {})
  });
  // 400: operation_ids 중복·계획에 없는 ID·고르지 않은 작업에 의존하는 작업을 고름(AI 계약).
  if (decision === "approve" && operationIds && response.status === 400) throw new AgentChatError("invalidSelection", INVALID_SELECTION_MESSAGE);
  return parseJsonOrThrow<AgentPlanRun>(response, "계획 승인·거절을 처리하지 못했습니다. 최신 상태를 확인해주세요.");
}

/** 명시적 사용자 취소. 이미 반영된 변경은 기존 역순 복구를 요청한다. */
export async function cancelAgentPlanRun(workspaceId: string, runId: string): Promise<AgentPlanRun> {
  const response = await apiFetch(workspacePath(workspaceId, "agent", "runs", runId, "cancel"), {
    method: "POST",
    headers: idempotentJsonHeaders()
  });
  return parseJsonOrThrow<AgentPlanRun>(response, "작업 취소 상태를 확인하지 못했습니다.");
}
