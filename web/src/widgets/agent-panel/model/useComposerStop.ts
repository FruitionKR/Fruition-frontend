import { useEffect, useRef, useState } from "react";
import { publishNotice } from "@/features/document-notifications";
import { requestAgentTurnCancel } from "@/features/agent-chat/api/agent";
import { activeTurnStopOutcome, type StalledTurnCancelResult } from "@/features/agent-chat/lib/stalledTurns";
import type { ComposerStopTarget } from "../lib/composerStop";

/** 중지 요청을 이만큼만 기다린다. 응답이 없으면 전하지 못한 것으로 보고 다시 따라간다. */
const CANCEL_REQUEST_TIMEOUT_MS = 10_000;

async function requestCancel(turnId: string): Promise<StalledTurnCancelResult> {
  try {
    return await requestAgentTurnCancel(turnId, AbortSignal.timeout(CANCEL_REQUEST_TIMEOUT_MS));
  } catch {
    return { kind: "failed" };
  }
}

/**
 * 입력창 Esc로 지금 진행 중인 것 하나(target)를 멈춘다. 멈추는 동안(isStopping) 다시 누른 Esc는 무시한다.
 * - 보내기 전 스킬 실행: 보내지 않고 실행을 취소한다('실행 취소'와 같다)
 * - 채팅 질의: 기존 질의 취소(ai/tasks/{id}/cancel)
 * - 이 화면이 따라가는 작업: 따라가기(SSE·조회)를 멈추고 서버 취소를 요청한다. turn ID를 받기 전이면 받는 즉시 요청한다
 * - 서버 기록의 진행 중 작업·질의: 응답을 받지 못한 작업·질의 '닫기'와 같다
 */
export function useComposerStop({
  target,
  cancelSkillRun,
  cancelQuery,
  followingTurnId,
  isTurnFollowing,
  stopFollowing,
  finishFollowing,
  resumeFollowing,
  closePendingTurn,
  closePendingQuery,
  releaseTurns,
  refreshMessages
}: {
  target: ComposerStopTarget | null;
  cancelSkillRun: () => void;
  cancelQuery: () => void;
  followingTurnId: string | null;
  isTurnFollowing: boolean;
  stopFollowing: () => void;
  finishFollowing: () => void;
  resumeFollowing: (turnId: string) => void;
  closePendingTurn: (turnId: string) => Promise<void>;
  closePendingQuery: (runId: string) => Promise<void>;
  releaseTurns: (turnIds: readonly string[]) => void;
  refreshMessages: () => Promise<unknown>;
}) {
  // 멈추는 대상. 끝날 때까지 안내 문구를 이 대상으로 유지한다(멈추는 사이 대상이 바뀌어도).
  const [stoppingTarget, setStoppingTarget] = useState<ComposerStopTarget | null>(null);
  // 같은 렌더 안에서 Esc가 두 번 들어와도 한 번만 멈춘다.
  const isStoppingRef = useRef(false);

  async function cancelFollowingTurn(turnId: string) {
    stopFollowing();
    const outcome = activeTurnStopOutcome(await requestCancel(turnId));
    if (outcome.refresh) await refreshMessages().catch(() => undefined);
    if (outcome.release) releaseTurns([turnId]);
    // 다시 받은 목록에 "취소됨"이 보인 뒤 진행 카드를 내린다. 다시 따라가면 진행 카드를 이어서 쓴다.
    if (outcome.resume) resumeFollowing(turnId);
    else finishFollowing();
    if (outcome.notice) publishNotice({ kind: "failed", title: "작업 중지 실패", message: outcome.notice });
  }

  function finishStopping() {
    isStoppingRef.current = false;
    setStoppingTarget(null);
  }

  function runStop(next: ComposerStopTarget, work: Promise<void>) {
    isStoppingRef.current = true;
    setStoppingTarget(next);
    void work.finally(finishStopping);
  }

  // turn ID를 받기 전에 누른 Esc: ID를 받으면 취소를 요청하고, 받기 전에 요청이 끝났으면(실패 등) 그대로 둔다.
  const isAwaitingTurnId = stoppingTarget?.kind === "following-turn" && stoppingTarget.turnId === null;
  useEffect(() => {
    if (!isAwaitingTurnId) return;
    if (followingTurnId) {
      const turnId = followingTurnId;
      setStoppingTarget({ kind: "following-turn", turnId });
      void cancelFollowingTurn(turnId).finally(finishStopping);
      return;
    }
    if (!isTurnFollowing) finishStopping();
    // ID 도착·요청 종료에만 반응한다. 콜백 identity 변화로 다시 요청하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAwaitingTurnId, followingTurnId, isTurnFollowing]);

  function stop() {
    if (!target || isStoppingRef.current) return;
    switch (target.kind) {
      case "skill-run":
        cancelSkillRun();
        return;
      case "query":
        cancelQuery();
        return;
      case "following-turn":
        if (target.turnId) {
          runStop(target, cancelFollowingTurn(target.turnId));
          return;
        }
        isStoppingRef.current = true;
        setStoppingTarget(target);
        return;
      case "pending-turn":
        runStop(target, closePendingTurn(target.turnId));
        return;
      case "pending-query":
        runStop(target, closePendingQuery(target.runId));
    }
  }

  return { stop, stoppingTarget, isStopping: stoppingTarget !== null };
}
