import { apiFetch, parseJsonOrThrow, parseErrorResponse, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { readRunEvents, type RunStageEvent } from "@/shared/lib/runEventStream";
import type { AgentTurnRequest, AgentTurnResponse } from "../lib/agentTurn";

export const AGENT_TURN_CANCELLED_MESSAGE = "요청이 취소되었습니다.";
export const AGENT_TURN_ROLLBACK_FAILED_MESSAGE = "요청이 취소됐지만 변경 복구에 실패했습니다. 문서 내용을 확인해 주세요.";

/** run 응답이 종료 상태면 결과를 반환하고, 실패·취소·복구 실패면 던지고, 진행 중이면 null을 반환한다. */
function toTerminalResult(run: AgentTurnRunResponse): AgentTurnResponse | null {
  if (run.status === "completed" && run.result) return run as AgentTurnResponse;
  // error는 내부 코드(provider_unavailable 등)이고 화면 문구는 error_message에 온다(document #119, #152).
  if (run.status === "failed") throw new Error(run.error_message || ERROR_MESSAGES.agentTurnFailed);
  // SSE가 끊긴 뒤 조회한 취소 종결 상태는 연결 종료 안내가 아니라 취소·복구 실패로 구분한다(#141).
  if (run.status === "cancelled") throw new Error(AGENT_TURN_CANCELLED_MESSAGE);
  if (run.status === "rollback_failed") throw new Error(run.error_message || AGENT_TURN_ROLLBACK_FAILED_MESSAGE);
  return null;
}

export async function requestAgentTurn(
  request: AgentTurnRequest,
  handlers: {
    onStage: (event: RunStageEvent) => void;
    signal: AbortSignal;
    /** 서버가 turn을 받아 ID를 정했을 때. 화면은 이 ID로 세션 메시지를 작업 탭에 묶는다. */
    onAccepted?: (requestId: string) => void;
  }
): Promise<AgentTurnResponse> {
  const signal = AbortSignal.any([handlers.signal, AbortSignal.timeout(300_000)]);
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(workspacePath(workspaceId, "agent", "turn"), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const run = await parseJsonOrThrow<AgentTurnRunResponse>(response, ERROR_MESSAGES.agentTurnFailed);
  handlers.onAccepted?.(run.requestId);
  // 생성 응답이 이미 종료 상태면 첫 대기 없이 바로 반환한다.
  const initial = toTerminalResult(run);
  if (initial) return initial;
  const path = workspacePath(workspaceId, "agent", "turn", run.requestId);
  const events = await apiFetch(`${path}/events`, {
    headers: { Accept: "text/event-stream" }, cache: "no-store", signal
  });
  if (!events.ok || !events.body) {
    throw new Error(await parseErrorResponse(events, ERROR_MESSAGES.agentTurnFailed));
  }
  const terminal = await readRunEvents(events, handlers.onStage, ERROR_MESSAGES.agentTurnFailed);
  if (terminal === "cancelled") throw new Error(AGENT_TURN_CANCELLED_MESSAGE);
  const statusResponse = await apiFetch(path, { cache: "no-store", signal });
  const status = await parseJsonOrThrow<AgentTurnRunResponse>(statusResponse, ERROR_MESSAGES.agentTurnFailed);
  const result = toTerminalResult(status);
  if (!result) throw new Error("진행 상태 연결이 종료되었습니다. 채팅을 다시 열어 결과를 확인해 주세요.");
  return result;
}

/** 끝난 편집 turn의 대상 문서와 적용 ID. 새로 고침 뒤 버전 기록과 맞춰 적용 여부를 알아낸다. */
export async function fetchAgentTurnApplyTarget(
  workspaceId: string,
  turnId: string,
  signal?: AbortSignal
): Promise<{ documentId: string | null; applyOperationId: string | null }> {
  const response = await apiFetch(workspacePath(workspaceId, "agent", "turn", turnId), { cache: "no-store", signal });
  const turn = await parseJsonOrThrow<{ documentId?: string | null; apply_operation_id?: string | null }>(
    response,
    ERROR_MESSAGES.agentTurnFailed
  );
  return { documentId: turn.documentId ?? null, applyOperationId: turn.apply_operation_id ?? null };
}

type AgentTurnRunResponse =Omit<AgentTurnResponse, "status" | "result"> & {
  status: string;
  result: AgentTurnResponse["result"] | null;
  /** 실패 코드. 화면에 그대로 보여 주지 않는다. */
  error?: string | null;
  /** 서버가 코드를 바꾼 한국어 문구(document #119 이후). */
  error_message?: string | null;
};
