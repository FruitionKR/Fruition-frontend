import { analyticsSessionHeaders } from "@/shared/lib/analytics/client";
import { apiFetch, parseJsonOrThrow, parseApiError, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { ApiError } from "@/shared/lib/apiErrors";
import { readRunEvents, RunFailedError, type RunStageEvent } from "@/shared/lib/runEventStream";
import { followAgentTurn } from "@/features/agent-chat/lib/turnFollow";
import type { AgentTurnRequest, AgentTurnResponse } from "../lib/agentTurn";
import type { StalledTurnCancelResult, TurnCheckResult } from "../lib/stalledTurns";

export const AGENT_TURN_CANCELLED_MESSAGE = "요청이 취소되었습니다.";
export const AGENT_TURN_ROLLBACK_FAILED_MESSAGE = "요청이 취소됐지만 변경 복구에 실패했습니다. 문서 내용을 확인해 주세요.";

/** turn이 실패·취소·복구 실패로 끝났다는 오류. 다시 조회해도 바뀌지 않는다. */
class AgentTurnSettledError extends Error {}

/** run 응답이 종료 상태면 결과를 반환하고, 실패·취소·복구 실패면 던지고, 진행 중이면 null을 반환한다. */
function toTerminalResult(run: AgentTurnRunResponse): AgentTurnResponse | null {
  if (run.status === "completed" && run.result) return run as AgentTurnResponse;
  // error는 내부 코드(provider_unavailable 등)이고 화면 문구는 error_message에 온다(document #119, #152).
  if (run.status === "failed") throw new AgentTurnSettledError(run.error_message || ERROR_MESSAGES.agentTurnFailed);
  // SSE가 끊긴 뒤 조회한 취소 종결 상태는 연결 종료 안내가 아니라 취소·복구 실패로 구분한다(#141).
  if (run.status === "cancelled") throw new AgentTurnSettledError(AGENT_TURN_CANCELLED_MESSAGE);
  if (run.status === "rollback_failed") throw new AgentTurnSettledError(run.error_message || AGENT_TURN_ROLLBACK_FAILED_MESSAGE);
  return null;
}

/** 다시 확인해도 결과가 바뀌지 않는 오류: 서버가 알린 실패·취소, 4xx(권한·없는 turn). 네트워크·5xx는 다시 조회한다. */
function isFatalTurnError(error: unknown): boolean {
  if (error instanceof AgentTurnSettledError || error instanceof RunFailedError) return true;
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

async function fetchTerminalTurn(path: string, signal: AbortSignal): Promise<AgentTurnResponse | null> {
  const response = await apiFetch(path, { cache: "no-store", signal });
  return toTerminalResult(await parseJsonOrThrow<AgentTurnRunResponse>(response, ERROR_MESSAGES.agentTurnFailed));
}

type AgentTurnHandlers = {
  onStage: (event: RunStageEvent) => void;
  signal: AbortSignal;
  /** 서버가 turn을 받아 ID를 정했을 때. 화면은 이 ID로 세션 메시지를 작업 탭에 묶는다. */
  onAccepted?: (requestId: string) => void;
  /** 진행 연결이 끊겨 조회로 확인하는 중일 때. 화면은 빨간 오류 대신 기다림 안내를 보여 준다. */
  onSlow?: () => void;
};

/**
 * 작업 turn을 만들고 끝날 때까지 기다린다. 진행 SSE가 종료 이벤트 없이 끊기면(약 5분 뒤 서버·프록시가 끊는 경우 등)
 * turn 조회로 넘어가 끝을 확인한다. 전체 시간 제한(AbortSignal.timeout)을 두지 않아 오래 걸리는 작업도 끝까지 따라간다.
 */
export async function requestAgentTurn(
  request: AgentTurnRequest,
  handlers: AgentTurnHandlers
): Promise<AgentTurnResponse> {
  const { signal } = handlers;
  const workspaceId = getWorkspaceId();
  const response = await apiFetch(workspacePath(workspaceId, "agent", "turn"), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...analyticsSessionHeaders() },
    body: JSON.stringify(request)
  });
  const run = await parseJsonOrThrow<AgentTurnRunResponse>(response, ERROR_MESSAGES.agentTurnFailed);
  handlers.onAccepted?.(run.requestId);
  // 생성 응답이 이미 종료 상태면 첫 대기 없이 바로 반환한다.
  const initial = toTerminalResult(run);
  if (initial) return initial;
  return followAgentTurnRun(workspaceId, run.requestId, handlers);
}

/**
 * 이미 만든 turn의 끝을 다시 확인한다(결과 확인이 끊긴 뒤 '다시 확인'). SSE 없이 조회만 한다.
 */
export function resumeAgentTurn(
  turnId: string,
  handlers: Pick<AgentTurnHandlers, "signal" | "onSlow">
): Promise<AgentTurnResponse> {
  const workspaceId = getWorkspaceId();
  const path = workspacePath(workspaceId, "agent", "turn", turnId);
  return followAgentTurn({
    fetchTerminal: () => fetchTerminalTurn(path, handlers.signal),
    isFatal: isFatalTurnError,
    onSlow: handlers.onSlow,
    signal: handlers.signal,
    cancelledMessage: AGENT_TURN_CANCELLED_MESSAGE
  });
}

function followAgentTurnRun(workspaceId: string, turnId: string, handlers: AgentTurnHandlers): Promise<AgentTurnResponse> {
  const { signal } = handlers;
  const path = workspacePath(workspaceId, "agent", "turn", turnId);
  return followAgentTurn({
    readEvents: async () => {
      const events = await apiFetch(`${path}/events`, {
        headers: { Accept: "text/event-stream" }, cache: "no-store", signal
      });
      if (!events.ok || !events.body) throw await parseApiError(events, ERROR_MESSAGES.agentTurnFailed);
      return readRunEvents(events, handlers.onStage, ERROR_MESSAGES.agentTurnFailed);
    },
    fetchTerminal: () => fetchTerminalTurn(path, signal),
    isFatal: isFatalTurnError,
    onSlow: handlers.onSlow,
    signal,
    cancelledMessage: AGENT_TURN_CANCELLED_MESSAGE
  });
}

/**
 * 오래 pending에 머문 turn을 한 번 조회한다. 404면 서버에 turn이 없다(missing). 그 밖의 실패는 던진다.
 * 화면은 이 결과로 '응답을 받지 못했어요'를 띄우고, '닫기'로 취소(requestAgentTurnCancel)를 요청한 뒤 입력 잠금을 푼다.
 */
export async function checkAgentTurnStatus(turnId: string, signal?: AbortSignal): Promise<TurnCheckResult> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "agent", "turn", turnId), { cache: "no-store", signal });
  if (response.status === 404) return { kind: "missing" };
  const run = await parseJsonOrThrow<{ status?: string }>(response, ERROR_MESSAGES.agentTurnFailed);
  return { kind: "status", status: run.status ?? "" };
}

/**
 * agent turn 취소를 요청만 한다(복구 완료까지 기다리지 않는다). 응답을 받지 못한 작업을 닫을 때 쓴다.
 * 200은 취소 계열 상태(이미 취소 중·취소됨이면 그 상태 그대로), 404는 없는 turn(missing), 409는 이미 끝난 turn(finished).
 * 그 밖의 실패(400·5xx·네트워크)는 던진다.
 */
export async function requestAgentTurnCancel(turnId: string, signal?: AbortSignal): Promise<StalledTurnCancelResult> {
  const response = await apiFetch(workspacePath(getWorkspaceId(), "agent", "turn", turnId, "cancel"), { method: "POST", signal });
  if (response.status === 404) return { kind: "missing" };
  if (response.status === 409) return { kind: "finished" };
  const run = await parseJsonOrThrow<{ status?: string }>(response, ERROR_MESSAGES.agentTurnFailed);
  return { kind: "status", status: run.status ?? "" };
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
