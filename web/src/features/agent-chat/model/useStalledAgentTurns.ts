import { useCallback, useEffect, useMemo, useState } from "react";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { checkAgentTurnStatus } from "../api/agent";
import {
  classifyTurnCheck,
  pendingAgentTurns,
  STALLED_TURN_AGE_MS,
  STALLED_TURN_TICK_MS,
  turnsToCheck,
  type PendingRun,
  type TurnCheckResult,
  type TurnCheckVerdict
} from "../lib/stalledTurns";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";

const RELEASED_STORAGE_PREFIX = "fruition:released-turns";
const RELEASED_LIMIT = 100;
const NO_TURNS: ReadonlySet<string> = new Set();

function readReleased(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeReleased(key: string, ids: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids].slice(-RELEASED_LIMIT)));
  } catch {
    // 저장하지 못하면 이번 화면에서만 기억한다. 새로 고침 뒤에는 다시 확인해 같은 안내가 뜬다.
  }
}

/**
 * 사용자가 '닫기'로 입력 잠금을 푼 turn. 서버 메시지는 pending에 남아도 더 이상 입력·세션 전환을 막지 않는다.
 * 새로 고침 뒤에도 다시 막히지 않게 워크스페이스·세션별 localStorage에 둔다.
 */
export function useReleasedTurns(activeSessionId: string | null) {
  const storageKey = useMemo(() => {
    const workspaceId = getSelectedWorkspaceId();
    return workspaceId && activeSessionId ? `${RELEASED_STORAGE_PREFIX}:${workspaceId}:${activeSessionId}` : null;
  }, [activeSessionId]);
  const [released, setReleased] = useState<{ key: string | null; ids: ReadonlySet<string> }>({ key: null, ids: NO_TURNS });
  useEffect(() => {
    setReleased({ key: storageKey, ids: storageKey ? readReleased(storageKey) : NO_TURNS });
  }, [storageKey]);
  const releasedTurnIds = released.key === storageKey ? released.ids : NO_TURNS;
  const releaseTurns = useCallback((turnIds: readonly string[]) => {
    if (turnIds.length === 0) return;
    setReleased((current) => {
      const base = current.key === storageKey ? current.ids : NO_TURNS;
      const ids = new Set([...base, ...turnIds]);
      if (storageKey) writeReleased(storageKey, ids);
      return { key: storageKey, ids };
    });
  }, [storageKey]);
  return { releasedTurnIds, releaseTurns };
}

type RunCheck = (runId: string, signal: AbortSignal) => Promise<TurnCheckResult>;
type PendingSelector = (messages: readonly ChatMessageResponse[], now: number) => PendingRun[];

/**
 * pending에 오래 머문 run(agent turn·채팅 질의)을 서버 조회로 확인해 응답을 받지 못한 run을 찾는다.
 * - thresholdMs 넘게 pending인데 서버가 아직 끝나지 않았다고 하거나 run이 없으면(404) stalled
 * - 이 화면이 따라가다 결과 확인을 포기한 run(lostRunId)도 stalled
 * - force면 오래되지 않은 run도 한 번 확인해 404면 바로 푼다
 * - 이미 끝났다고 하면 목록을 다시 받는다(다음 확인에도 메시지가 pending이면 stalled)
 * selectPending·check는 모듈 수준 함수처럼 identity가 바뀌지 않아야 한다.
 */
export function useStalledRuns({
  messages,
  selectPending,
  check,
  thresholdMs,
  ignoredRunIds,
  lostRunId = null,
  force = false,
  enabled = true,
  refreshMessages
}: {
  messages: ChatMessageResponse[];
  selectPending: PendingSelector;
  check: RunCheck;
  thresholdMs: number;
  /** 지금 따라가는 run·이미 닫은 run */
  ignoredRunIds: ReadonlySet<string>;
  lostRunId?: string | null;
  force?: boolean;
  /** false면 확인하지 않는다(이 화면이 run을 직접 따라가는 동안 등) */
  enabled?: boolean;
  refreshMessages: () => Promise<unknown>;
}): ReadonlySet<string> {
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, TurnCheckVerdict>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  const pending = useMemo(() => selectPending(messages, now), [messages, now, selectPending]);
  const hasPending = pending.length > 0;

  useEffect(() => {
    if (!hasPending) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), STALLED_TURN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [hasPending]);

  useEffect(() => {
    if (!lostRunId) return;
    setVerdicts((current) => new Map(current).set(lostRunId, "stalled"));
  }, [lostRunId]);

  const targetsNow = enabled ? turnsToCheck(pending, verdicts, { force, ignoredTurnIds: ignoredRunIds, thresholdMs }) : [];
  const checkKey = targetsNow
    .map(({ turnId, ageMs }) => `${turnId}:${ageMs >= 0 ? Math.floor(ageMs / STALLED_TURN_TICK_MS) : 0}`)
    .join("|");
  useEffect(() => {
    const targets = targetsNow;
    if (targets.length === 0) return;
    const controller = new AbortController();
    void Promise.all(targets.map(async ({ turnId, ageMs }) => {
      try {
        const verdict = classifyTurnCheck(await check(turnId, controller.signal), ageMs, verdicts.get(turnId), thresholdMs);
        return [turnId, verdict] as const;
      } catch {
        // 네트워크·5xx는 판단하지 않는다. 다음 확인 주기에 다시 본다.
        return null;
      }
    })).then((results) => {
      if (controller.signal.aborted) return;
      const decided = results.filter((result): result is readonly [string, TurnCheckVerdict] => result !== null);
      if (decided.length === 0) return;
      setVerdicts((current) => {
        const next = new Map(current);
        decided.forEach(([turnId, verdict]) => next.set(turnId, verdict));
        return next;
      });
      if (decided.some(([, verdict]) => verdict === "settled")) void refreshMessages().catch(() => undefined);
    });
    return () => controller.abort();
    // checkKey가 대상·나이 구간을 담는다. 폴링마다 바뀌는 messages identity로 다시 요청하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  return useMemo(() => {
    const pendingIds = new Set(pending.map(({ turnId }) => turnId));
    return new Set([...verdicts].flatMap(([turnId, verdict]) =>
      verdict === "stalled" && pendingIds.has(turnId) && !ignoredRunIds.has(turnId) ? [turnId] : []));
  }, [ignoredRunIds, pending, verdicts]);
}

/**
 * pending에 오래 머문 agent turn을 `GET agent/turn/{id}`로 확인해 응답을 받지 못한 turn을 찾는다(10분 기준).
 * 스킬 실행이 pending에 막혀 기다리는 동안(force)은 오래되지 않은 turn도 한 번 확인해 404면 바로 푼다.
 */
export function useStalledAgentTurns({
  messages,
  ignoredTurnIds,
  lostTurnId,
  force,
  refreshMessages
}: {
  messages: ChatMessageResponse[];
  /** 지금 따라가는 turn·이미 닫은 turn */
  ignoredTurnIds: ReadonlySet<string>;
  lostTurnId: string | null;
  force: boolean;
  refreshMessages: () => Promise<unknown>;
}): ReadonlySet<string> {
  return useStalledRuns({
    messages,
    selectPending: pendingAgentTurns,
    check: checkAgentTurnStatus,
    thresholdMs: STALLED_TURN_AGE_MS,
    ignoredRunIds: ignoredTurnIds,
    lostRunId: lostTurnId,
    force,
    refreshMessages
  });
}
