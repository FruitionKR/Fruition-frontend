import { useCallback, useState } from "react";
import { publishNotice } from "@/features/document-notifications";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { requestAgentTurnCancel, resumeAgentTurn } from "../api/agent";
import { isTurnCancelAccepted, stalledTurnCancelOutcome, type StalledTurnCancelResult } from "../lib/stalledTurns";

/** 닫기 취소 요청·끝난 turn 조회를 이만큼만 기다린다. 응답이 없어도 화면 잠금은 푼다. */
const CANCEL_REQUEST_TIMEOUT_MS = 10_000;
const NO_TURNS: ReadonlySet<string> = new Set();

async function requestCancel(turnId: string): Promise<StalledTurnCancelResult> {
  try {
    return await requestAgentTurnCancel(turnId, AbortSignal.timeout(CANCEL_REQUEST_TIMEOUT_MS));
  } catch {
    return { kind: "failed" };
  }
}

/**
 * 닫으려던 turn이 이미 끝나 있었으면(409) 그 turn을 다시 받아 끝난 결과를 알린다. 지난 기록의 turn은 편집안을 다시 띄울
 * 요청 문맥이 없어, 결과는 다시 받은 작업 목록에서 보고 여기서는 완료·실패만 알린다.
 */
export async function announceFinishedTurn(turnId: string): Promise<void> {
  try {
    await resumeAgentTurn(turnId, { signal: AbortSignal.timeout(CANCEL_REQUEST_TIMEOUT_MS) });
    publishNotice({ kind: "info", title: "이미 끝난 작업", message: "닫으려던 작업이 이미 끝나 있었어요. 작업 목록에서 결과를 확인해 주세요." });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) return;
    publishNotice({ kind: "failed", title: "이미 끝난 작업", message: getErrorMessage(error, "닫으려던 작업이 이미 실패로 끝나 있었어요.") });
  }
}

/**
 * 응답을 받지 못한 작업 turn을 '닫기'로 닫는다. 서버 취소(`POST agent/turn/{id}/cancel`)를 먼저 요청하고,
 * 결과와 상관없이 releaseTurns로 입력 잠금을 푼다(워크스페이스·세션별로 기억). 취소가 받아들여지면 서버가 pending 메시지를
 * cancelled로 닫으므로 잠금을 풀기 전에 목록을 다시 받아 "취소됨"으로 바로 보이게 한다.
 * 이미 끝난 turn(409)의 ID를 돌려줘 화면이 그 결과를 다시 받아 보여 주게 한다.
 */
export function useCloseStalledTurns({
  releaseTurns,
  refreshMessages,
  onCancelAccepted
}: {
  releaseTurns: (turnIds: readonly string[]) => void;
  refreshMessages: () => Promise<unknown>;
  /** 서버가 취소를 받아들인 turn. 목록이 아직 pending이어도 "취소됨"으로 보이게 한다. */
  onCancelAccepted?: (turnIds: readonly string[]) => void;
}) {
  const [closingTurnIds, setClosingTurnIds] = useState<ReadonlySet<string>>(NO_TURNS);

  const closeStalledTurns = useCallback(async (turnIds: readonly string[]): Promise<string[]> => {
    if (turnIds.length === 0) return [];
    setClosingTurnIds((current) => new Set([...current, ...turnIds]));
    const results = await Promise.all(turnIds.map(requestCancel));
    const outcomes = results.map(stalledTurnCancelOutcome);
    const acceptedIds = turnIds.filter((_, index) => isTurnCancelAccepted(results[index]));
    if (acceptedIds.length > 0) onCancelAccepted?.(acceptedIds);
    if (outcomes.some((outcome) => outcome.refresh)) await refreshMessages().catch(() => undefined);
    releaseTurns(turnIds);
    setClosingTurnIds((current) => new Set([...current].filter((turnId) => !turnIds.includes(turnId))));
    [...new Set(outcomes.flatMap((outcome) => (outcome.notice ? [outcome.notice] : [])))]
      .forEach((message) => publishNotice({ kind: "failed", title: "작업 취소 확인 실패", message }));
    return turnIds.filter((_, index) => outcomes[index].showResult);
  }, [onCancelAccepted, refreshMessages, releaseTurns]);

  return { closingTurnIds, closeStalledTurns };
}
