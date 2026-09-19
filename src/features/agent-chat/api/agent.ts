import { apiFetch, parseJsonOrThrow, parseErrorResponse, getWorkspaceId, workspacePath, ERROR_MESSAGES } from "@/shared/api/client";
import { readRunEvents, type RunStageEvent } from "@/shared/lib/runEvents";
import type { AgentTurnRequest, AgentTurnResponse } from "../lib/markdownAgent";

/** run 응답이 종료 상태면 결과를 반환하고, 실패면 던지고, 진행 중이면 null을 반환한다. */
function toTerminalResult(run: AgentTurnRunResponse): AgentTurnResponse | null {
  if (run.status === "completed" && run.result) return run as AgentTurnResponse;
  if (run.status === "failed") throw new Error(run.error || ERROR_MESSAGES.agentTurnFailed);
  return null;
}

export async function requestAgentTurn(
  request: AgentTurnRequest,
  handlers: { onStage: (event: RunStageEvent) => void; signal: AbortSignal }
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
  if (terminal === "cancelled") throw new Error("요청이 취소되었습니다.");
  const statusResponse = await apiFetch(path, { cache: "no-store", signal });
  const status = await parseJsonOrThrow<AgentTurnRunResponse>(statusResponse, ERROR_MESSAGES.agentTurnFailed);
  const result = toTerminalResult(status);
  if (!result) throw new Error("진행 상태 연결이 종료되었습니다. 채팅을 다시 열어 결과를 확인해 주세요.");
  return result;
}

type AgentTurnRunResponse = Omit<AgentTurnResponse, "status" | "result"> & {
  status: string;
  result: AgentTurnResponse["result"] | null;
  error?: string | null;
};
