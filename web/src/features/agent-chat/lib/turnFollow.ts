/**
 * 작업 turn의 끝을 기다리는 흐름. 진행 SSE를 먼저 읽고, SSE가 종료 이벤트 없이 끊기면(서버 broken pipe·프록시 시간 초과 등)
 * `GET agent/turn/{id}` 조회로 넘어가 끝날 때까지 확인한다. 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

/** SSE가 끊겨 조회로 확인하는 동안 진행 카드에 보여 주는 안내. 실패가 아니라 빨간 오류로 두지 않는다. */
export const AGENT_TURN_SLOW_MESSAGE = "응답이 오래 걸리고 있어요. 계속 확인하는 중이에요.";

/** 조회도 계속 실패하거나 너무 오래 끝나지 않아 결과를 확인하지 못했을 때. 작업은 서버에서 계속될 수 있다. */
export const AGENT_TURN_LOST_MESSAGE = "응답을 확인하지 못했어요. 작업은 계속 진행될 수 있으니 잠시 뒤 다시 확인해 주세요.";

/** 결과를 확인하지 못한 채 따라가기를 멈췄다는 오류. 화면은 '다시 확인'으로 같은 turn을 이어서 확인하게 한다. */
export class AgentTurnLostError extends Error {
  constructor() {
    super(AGENT_TURN_LOST_MESSAGE);
    this.name = "AgentTurnLostError";
  }
}

/** 조회 주기. */
export const TURN_POLL_INTERVAL_MS = 3_000;
/** 연속으로 이만큼 조회가 실패하면(네트워크·5xx) 확인을 멈춘다. */
export const TURN_POLL_MAX_FAILURES = 10;
/** 조회로 넘어간 뒤 이만큼 지나도 끝나지 않으면 확인을 멈춘다. */
export const TURN_POLL_DEADLINE_MS = 30 * 60_000;

/** SSE 결과. closed는 종료 이벤트 없이 연결이 끝난 경우다. */
export type TurnStreamOutcome = "completed" | "cancelled" | "closed";

export type FollowTurnDeps<T> = {
  /** 진행 SSE를 끝까지 읽는다. 없으면 바로 조회한다(결과 다시 확인). */
  readEvents?: () => Promise<TurnStreamOutcome>;
  /** turn을 한 번 조회한다. 끝났으면 결과, 진행 중이면 null. 실패·취소로 끝났으면 던진다. */
  fetchTerminal: () => Promise<T | null>;
  /** 다시 시도해도 바뀌지 않는 오류인지(서버가 알린 실패·취소, 4xx). 아니면 일시적 오류로 보고 계속 조회한다. */
  isFatal: (error: unknown) => boolean;
  /** SSE가 끝났는데 아직 결과가 없어 조회로 넘어갈 때 한 번 부른다. */
  onSlow?: () => void;
  signal: AbortSignal;
  cancelledMessage: string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  maxPollFailures?: number;
  deadlineMs?: number;
};

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** SSE → (끊기면) 조회 순으로 turn의 끝을 기다린다. 사용자가 취소(signal)하면 그대로 멈춘다. */
export async function followAgentTurn<T>(deps: FollowTurnDeps<T>): Promise<T> {
  const {
    readEvents,
    fetchTerminal,
    isFatal,
    onSlow,
    signal,
    cancelledMessage,
    sleep = defaultSleep,
    now = Date.now,
    pollIntervalMs = TURN_POLL_INTERVAL_MS,
    maxPollFailures = TURN_POLL_MAX_FAILURES,
    deadlineMs = TURN_POLL_DEADLINE_MS
  } = deps;

  let outcome: TurnStreamOutcome | "dropped" = "closed";
  if (readEvents) {
    try {
      outcome = await readEvents();
    } catch (error) {
      if (signal.aborted || isFatal(error)) throw error;
      // 네트워크 끊김·시간 초과 같은 연결 오류. 작업은 서버에서 계속되므로 조회로 확인한다.
      outcome = "dropped";
    }
  }
  if (outcome === "cancelled") throw new Error(cancelledMessage);

  let hasNotifiedSlow = false;
  let failures = 0;
  const startedAt = now();
  while (true) {
    if (signal.aborted) throw abortError(signal);
    try {
      const result = await fetchTerminal();
      if (result) return result;
      failures = 0;
    } catch (error) {
      if (signal.aborted || isFatal(error)) throw error;
      failures += 1;
      if (failures >= maxPollFailures) throw new AgentTurnLostError();
    }
    if (!hasNotifiedSlow) {
      hasNotifiedSlow = true;
      onSlow?.();
    }
    if (now() - startedAt >= deadlineMs) throw new AgentTurnLostError();
    await sleep(pollIntervalMs, signal);
  }
}
