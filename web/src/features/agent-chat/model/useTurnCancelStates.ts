import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { publishNotice } from "@/features/document-notifications";
import { getWorkspaceId } from "@/shared/api/client";
import { checkAgentTurnStatus } from "../api/agent";
import { PLAN_POLL_INTERVAL_MS } from "../lib/agentPlan";
import {
  isTurnCancelling,
  shouldPollTurnCancel,
  turnCancelSettledNotice,
  turnCancelState,
  type TurnCancelState,
  type TurnCheckResult
} from "../lib/stalledTurns";

function turnCancelQueryKey(workspaceId: string, turnId: string) {
  return ["agentTurnCancel", workspaceId, turnId] as const;
}

/**
 * 취소한 turn(서버가 cancelled로 닫은 말풍선·취소를 받아들인 pending 말풍선)이 되돌리기를 마쳤는지 turn 조회
 * (`GET agent/turn/{id}`)로 확인한다. 취소하는 중(cancel_requested·rolling_back)이면 계획 조회와 같은 주기로 다시 묻되
 * TURN_CANCEL_POLL_LIMIT번에서 멈춘다. 끝난 turn은 다시 묻지 않는다. 새로 고침 뒤에도 서버 상태로 같은 표시가 된다.
 * 이 화면에서 취소하는 중이던 turn이 복구 실패로 끝나면 알림을 띄운다.
 *
 * seed: 취소 요청 응답으로 받은 상태를 바로 써서 첫 조회를 기다리지 않게 한다.
 */
export function useTurnCancelStates(turnIds: readonly string[]) {
  const workspaceId = getWorkspaceId();
  const client = useQueryClient();
  const queries = useQueries({
    queries: turnIds.map((turnId) => ({
      queryKey: turnCancelQueryKey(workspaceId, turnId),
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<TurnCheckResult> => checkAgentTurnStatus(turnId, signal),
      retry: false,
      refetchInterval: (query: { state: { data?: TurnCheckResult; error: unknown; dataUpdateCount: number } }) =>
        !query.state.error && shouldPollTurnCancel(query.state.data, query.state.dataUpdateCount) ? PLAN_POLL_INTERVAL_MS : false,
      staleTime: (query: { state: { data?: TurnCheckResult } }) => (isTurnCancelling(turnCancelState(query.state.data)) ? 0 : Infinity)
    }))
  });
  const signature = queries.map((query) => turnCancelState(query.data) ?? "").join("|");
  const states = useMemo(() => {
    const values = signature.split("|");
    return new Map<string, TurnCancelState>(turnIds.flatMap((turnId, index) => {
      const state = values[index] as TurnCancelState | "";
      return state ? [[turnId, state]] : [];
    }));
    // signature가 상태를 모두 담는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, turnIds.join("|")]);

  const previous = useRef<ReadonlyMap<string, TurnCancelState>>(new Map());
  useEffect(() => {
    for (const [turnId, state] of states) {
      const message = turnCancelSettledNotice(previous.current.get(turnId), state);
      if (message) publishNotice({ kind: "failed", title: "작업 취소 확인 실패", message });
    }
    previous.current = states;
  }, [states]);

  const seed = useCallback((turnId: string, result: TurnCheckResult) => {
    client.setQueryData(turnCancelQueryKey(workspaceId, turnId), result);
  }, [client, workspaceId]);

  return { cancelStates: states as ReadonlyMap<string, TurnCancelState>, seedCancelState: seed };
}
