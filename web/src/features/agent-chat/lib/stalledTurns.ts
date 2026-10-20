/**
 * 응답이 끝나지 않는 작업 turn·채팅 질의(작업자 중단 등으로 서버 메시지가 pending에 머문 경우).
 * pending 메시지가 있으면 입력창·세션 전환·스킬 실행이 모두 막히므로, 오래 머문 turn·질의를 조회로 확인해
 * "응답을 받지 못했어요"로 바꾸고 다시 시도·닫기로 풀 수 있게 한다. 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 */

/** 이만큼 지나도 pending인 turn은 조회로 끝났는지 확인한다. */
export const STALLED_TURN_AGE_MS = 10 * 60_000;
/** 확인 주기. pending 메시지가 바뀌지 않아도 이 간격으로 나이를 다시 잰다. */
export const STALLED_TURN_TICK_MS = 30_000;

export const STALLED_TURN_TITLE = "응답을 받지 못했어요";
export const STALLED_TURN_DETAIL = "작업이 중단됐을 수 있어요. 다시 시도하거나 닫고 다른 요청을 보내 주세요.";
/** 막힌 turn이 남아 있는 동안 입력창 아래에 보이는 안내 */
export const STALLED_TURN_COMPOSER_NOTICE = "응답을 받지 못한 작업이 있어요. 작업 탭에서 다시 시도하거나 닫아 주세요.";

/**
 * 이만큼 지나도 pending인 채팅 질의는 조회로 끝났는지 확인한다. 질의는 보통 1분 안에 끝나므로 작업 turn(10분)보다 짧게,
 * 이 앱이 AI 요청 하나를 가장 오래 기다리는 시간(agent turn 전체 타임아웃 300초)과 같게 둔다.
 */
export const STALLED_QUERY_AGE_MS = 5 * 60_000;
export const STALLED_QUERY_DETAIL = "질문 처리가 중단됐을 수 있어요. 다시 질문하거나 닫고 새로 질문해 주세요.";
export const STALLED_QUERY_RELEASED_DETAIL = "응답을 받지 못해 닫은 질문이에요.";
/** 막힌 질의가 남아 있는 동안 입력창 아래에 보이는 안내 */
export const STALLED_QUERY_COMPOSER_NOTICE = "응답을 받지 못한 질문이 있어요. 채팅에서 다시 질문하거나 닫아 주세요.";

/** agent turn run ID 접두사(document AgentTurnService). 질의 run은 query_로 시작한다. */
const AGENT_RUN_PREFIX = "agent_";
/** 채팅 질의 run ID 접두사. 질의 run ID는 AI task ID로도 그대로 쓰인다(ai/tasks/{id}). */
const QUERY_RUN_PREFIX = "query_";
const TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "cancelled", "rollback_failed"]);
/** 취소가 받아들여진 turn 상태(취소 중·복구 중·취소됨·복구 실패). 취소 API 응답과 turn 조회 응답에 같이 쓴다. */
export const TURN_CANCEL_STATUSES: ReadonlySet<string> = new Set(["cancel_requested", "rolling_back", "rollback_failed", "cancelled"]);

type PendingCandidate = {
  role: string;
  status: string;
  run_id?: string;
  created_at?: string | null;
};

function isPendingRunMessage(message: PendingCandidate, prefix: string): boolean {
  return message.role === "assistant" && message.status === "pending" && Boolean(message.run_id?.startsWith(prefix));
}

/** 서버 기록에서 아직 끝나지 않은(pending) agent turn 메시지인지 */
export function isPendingAgentTurnMessage(message: PendingCandidate): boolean {
  return isPendingRunMessage(message, AGENT_RUN_PREFIX);
}

/** 서버 기록에서 아직 끝나지 않은(pending) 채팅 질의 메시지인지 */
export function isPendingQueryMessage(message: PendingCandidate): boolean {
  return isPendingRunMessage(message, QUERY_RUN_PREFIX);
}

/** pending run의 ID와 나이(ms). 시각을 모르면 나이는 0으로 본다. */
export type PendingRun = { turnId: string; ageMs: number };

function pendingRuns(messages: readonly PendingCandidate[], now: number, prefix: string): PendingRun[] {
  return messages.flatMap((message) => {
    if (!isPendingRunMessage(message, prefix)) return [];
    const createdAt = message.created_at ? Date.parse(message.created_at) : Number.NaN;
    return [{ turnId: message.run_id!, ageMs: Number.isFinite(createdAt) ? Math.max(0, now - createdAt) : 0 }];
  });
}

/** pending agent turn의 ID와 나이(ms) */
export function pendingAgentTurns(messages: readonly PendingCandidate[], now: number): PendingRun[] {
  return pendingRuns(messages, now, AGENT_RUN_PREFIX);
}

/** pending 채팅 질의의 run ID와 나이(ms) */
export function pendingQueryRuns(messages: readonly PendingCandidate[], now: number): PendingRun[] {
  return pendingRuns(messages, now, QUERY_RUN_PREFIX);
}

/** turn·AI task 조회 결과. missing은 404(서버에 turn·task가 없음). */
export type TurnCheckResult = { kind: "status"; status: string } | { kind: "missing" };
/** stalled: 응답을 받지 못함, running: 아직 정상 진행, settled: 이미 끝남(목록을 다시 받으면 된다) */
export type TurnCheckVerdict = "stalled" | "running" | "settled";

/**
 * 조회 결과와 turn 나이로 판단한다. 서버에 없거나, 오래됐는데 아직 끝나지 않았으면 응답을 받지 못한 것으로 본다.
 * 끝났다고 하면 목록을 다시 받게 settled로 두되, 지난번에도 끝났다고 했는데 메시지가 여전히 pending이면
 * 메시지가 더 바뀌지 않을 것이므로 stalled로 본다(입력이 영영 막히지 않게).
 */
export function classifyTurnCheck(
  result: TurnCheckResult,
  ageMs: number,
  previous?: TurnCheckVerdict,
  thresholdMs = STALLED_TURN_AGE_MS
): TurnCheckVerdict {
  if (result.kind === "missing") return "stalled";
  if (TERMINAL_TURN_STATUSES.has(result.status)) return previous === "settled" ? "stalled" : "settled";
  return ageMs >= thresholdMs ? "stalled" : "running";
}

/**
 * 지금 조회할 turn. 오래된 turn은 stalled로 정하기 전까지 확인 주기마다 다시 확인한다.
 * force(스킬 실행이 막혀 기다리는 중)면 오래되지 않은 turn도 한 번 확인한다(404면 바로 풀 수 있게).
 */
export function turnsToCheck(
  pending: readonly PendingRun[],
  verdicts: ReadonlyMap<string, TurnCheckVerdict>,
  { force = false, ignoredTurnIds = new Set<string>(), thresholdMs = STALLED_TURN_AGE_MS }: {
    force?: boolean;
    /** 이 화면이 지금 따라가고 있는 turn·이미 닫은 turn */
    ignoredTurnIds?: ReadonlySet<string>;
    thresholdMs?: number;
  } = {}
): PendingRun[] {
  return pending.filter(({ turnId, ageMs }) => {
    if (ignoredTurnIds.has(turnId)) return false;
    const verdict = verdicts.get(turnId);
    if (verdict === "stalled") return false;
    if (ageMs >= thresholdMs) return true;
    return force && verdict === undefined;
  });
}

/** 입력을 막는 pending 메시지가 남아 있는지. 사용자가 닫은(released) turn은 더 이상 막지 않는다. */
export function hasBlockingPendingMessages(
  messages: readonly PendingCandidate[],
  releasedTurnIds: ReadonlySet<string>
): boolean {
  return messages.some((message) => message.role === "assistant" && message.status === "pending"
    && !(message.run_id && releasedTurnIds.has(message.run_id)));
}

type QuestionCandidate = PendingCandidate & { content: string; pair_id?: string };

/** 막힌 질의를 다시 보낼 질문. 같은 문답(pair_id)이나 같은 run의 사용자 메시지에서 찾고, 없으면 null. */
export function stalledQueryQuestion(messages: readonly QuestionCandidate[], runId: string): string | null {
  const answer = messages.find((message) => message.role === "assistant" && message.run_id === runId);
  const question = messages.find((message) => message.role === "user"
    && ((answer?.pair_id && message.pair_id === answer.pair_id) || message.run_id === runId));
  const text = question?.content.trim();
  return text ? text : null;
}

/** 막힌 질의를 닫으며 보낸 취소 요청의 결과. failed는 네트워크·5xx 등으로 서버에 전하지 못함. */
export type StalledQueryCancelResult = TurnCheckResult | { kind: "failed" };

/**
 * 닫기 취소 요청 결과에 대한 안내. 서버에 없거나(404) 취소를 받았으면 안내하지 않는다.
 * 화면 잠금은 결과와 상관없이 풀므로, 서버가 계속 처리 중일 수 있으면 그렇다고 알린다.
 */
export function stalledQueryCancelNotice(result: StalledQueryCancelResult): string | null {
  if (result.kind === "missing") return null;
  if (result.kind === "failed") return "질문을 닫았지만 서버에 취소를 전하지 못했어요. 서버에서는 아직 처리 중일 수 있어요.";
  if (result.status === "rollback_failed") return "질문을 닫았지만 서버가 질문의 변경을 복구하지 못했어요. 잠시 뒤 다시 확인해 주세요.";
  return null;
}

/** 막힌 작업 turn을 닫으며 보낸 취소 요청의 결과. finished는 409(이미 completed·failed로 끝남), failed는 서버에 전하지 못함. */
export type StalledTurnCancelResult = TurnCheckResult | { kind: "finished" } | { kind: "failed" };

/**
 * 취소 요청을 서버가 받아들였는지(200 + 취소 계열 상태). 서버가 메시지를 cancelled로 닫기 전에 목록을 다시 받으면
 * 아직 pending으로 오므로, 화면은 이 turn을 "중단됨"이 아니라 "취소됨"으로 보여 준다.
 */
export function isTurnCancelAccepted(result: StalledTurnCancelResult): result is { kind: "status"; status: string } {
  return result.kind === "status" && TURN_CANCEL_STATUSES.has(result.status);
}

/** 서버가 취소를 받아들인 turn과 그때 받은 turn 상태(cancel_requested·rolling_back·cancelled·rollback_failed) */
export type CancelAcceptedTurn = { turnId: string; status: string };

/** 닫기 취소 결과로 할 일. refresh: 세션 메시지를 다시 받는다, showResult: 이미 끝난 turn의 결과를 다시 받아 보여 준다. */
export type StalledTurnCancelOutcome = { notice: string | null; refresh: boolean; showResult: boolean };

/**
 * 막힌 작업 turn의 닫기 취소 결과를 해석한다. 화면 잠금은 결과와 상관없이 푼다.
 * - 취소 계열 상태: 서버가 pending 메시지를 cancelled로 닫았으니 목록을 다시 받는다(복구 실패면 알림)
 * - 404: 서버에 turn이 없다. 조용히 닫는다
 * - 409·그 밖의 상태: 이미 끝난 turn이라 결과가 묻히지 않게 다시 받아 보여 준다
 * - 전하지 못함: 서버가 계속 처리 중일 수 있다고 알린다
 */
export function stalledTurnCancelOutcome(result: StalledTurnCancelResult): StalledTurnCancelOutcome {
  if (result.kind === "missing") return { notice: null, refresh: false, showResult: false };
  if (result.kind === "failed") {
    return { notice: "작업을 닫았지만 서버에 취소를 전하지 못했어요. 서버에서는 아직 처리 중일 수 있어요.", refresh: false, showResult: false };
  }
  if (result.kind === "finished" || !TURN_CANCEL_STATUSES.has(result.status)) return { notice: null, refresh: true, showResult: true };
  if (result.status === "rollback_failed") {
    return { notice: "작업을 닫았지만 서버가 작업의 변경을 복구하지 못했어요. 문서 내용을 확인해 주세요.", refresh: true, showResult: false };
  }
  return { notice: null, refresh: true, showResult: false };
}

/**
 * 따라가던 작업을 입력창 Esc로 중지한 결과로 할 일. 화면은 취소를 요청하기 전에 따라가기(SSE·조회)를 먼저 멈춘다.
 * refresh: 세션 메시지를 다시 받는다, release: 입력 잠금을 푼다, resume: 같은 turn을 다시 따라간다(결과·진행이 묻히지 않게).
 */
export type ActiveTurnStopOutcome = { notice: string | null; refresh: boolean; release: boolean; resume: boolean };

/**
 * 진행 중인 작업을 Esc로 중지한 취소 요청 결과를 해석한다. 응답을 받지 못한 작업 '닫기'와 달리 서버에 전하지 못하면
 * 작업이 계속 진행 중이므로 잠금을 풀지 않고 다시 따라간다(Esc를 다시 누를 수 있다).
 * - 취소 계열 상태: 서버가 pending 메시지를 cancelled로 닫았으니 목록을 다시 받고 잠금을 푼다(복구 실패면 알림)
 * - 404: 서버에 turn이 없다. 조용히 잠금을 푼다
 * - 409·그 밖의 상태: 이미 끝난 turn이라 다시 따라가 결과를 보여 준다
 * - 전하지 못함: 다시 따라가고 알린다
 */
export function activeTurnStopOutcome(result: StalledTurnCancelResult): ActiveTurnStopOutcome {
  if (result.kind === "missing") return { notice: null, refresh: false, release: true, resume: false };
  if (result.kind === "failed") {
    return { notice: "작업을 중지하지 못했어요. 서버에 중지 요청을 전하지 못해 작업이 계속 진행 중이에요. 다시 Esc를 눌러 주세요.", refresh: false, release: false, resume: true };
  }
  if (result.kind === "finished" || !TURN_CANCEL_STATUSES.has(result.status)) return { notice: null, refresh: false, release: false, resume: true };
  if (result.status === "rollback_failed") {
    return { notice: "작업을 중지했지만 서버가 작업의 변경을 복구하지 못했어요. 문서 내용을 확인해 주세요.", refresh: true, release: true, resume: false };
  }
  return { notice: null, refresh: true, release: true, resume: false };
}

/**
 * 취소를 받아들인 turn이 지금 어디까지 왔는지. 서버는 취소를 받으면 말풍선(메시지)을 바로 cancelled로 닫지만,
 * turn은 cancel_requested → rolling_back(작업이 바꾼 내용을 되돌리는 중)을 거쳐 cancelled·rollback_failed로 끝난다.
 * requested·rolling_back: 취소하는 중, cancelled: 취소됨, rollback_failed: 취소했지만 변경을 되돌리지 못함.
 */
export type TurnCancelState = "requested" | "rolling_back" | "cancelled" | "rollback_failed";

/** 취소 중인 turn을 이만큼만 다시 조회한다(조회 주기 × 횟수). 넘으면 "취소하는 중…"으로 두고 다음에 열 때 다시 확인한다. */
export const TURN_CANCEL_POLL_LIMIT = 40;
export const TURN_CANCELLING_LABEL = "취소하는 중…";
export const TURN_ROLLBACK_FAILED_LABEL = "변경 복구 실패";
export const TURN_ROLLBACK_FAILED_DETAIL = "취소했지만 변경을 되돌리지 못했어요. 문서 내용을 확인해 주세요.";
/** 취소하는 중인 작업 카드의 설명. 되돌리는 단계인지 알 수 있게 나눠 적는다. */
export const TURN_CANCELLING_DETAIL: Record<"requested" | "rolling_back", string> = {
  requested: "작업을 멈추고 있어요.",
  rolling_back: "작업이 바꾼 내용을 되돌리고 있어요. 끝나면 '취소됨'으로 바뀌어요."
};

/**
 * turn 조회(또는 취소 응답) 결과 → 취소 진행 상태. 404(서버에 turn이 없음)와 취소 계열이 아닌 상태는 더 기다릴 것이 없어 취소됨으로 본다.
 * 아직 모르면 null.
 */
export function turnCancelState(result: TurnCheckResult | null | undefined): TurnCancelState | null {
  if (!result) return null;
  if (result.kind === "missing") return "cancelled";
  if (result.status === "cancel_requested") return "requested";
  if (result.status === "rolling_back" || result.status === "rollback_failed") return result.status;
  return "cancelled";
}

export function isTurnCancelling(state: TurnCancelState | null | undefined): boolean {
  return state === "requested" || state === "rolling_back";
}

/** 취소 중인 turn을 다시 조회할지. 끝났거나 상한(pollCount)에 닿으면 멈춘다. */
export function shouldPollTurnCancel(result: TurnCheckResult | null | undefined, pollCount: number): boolean {
  return isTurnCancelling(turnCancelState(result)) && pollCount < TURN_CANCEL_POLL_LIMIT;
}

/** 이 화면에서 취소하는 중이던 turn이 복구 실패로 끝났을 때만 알림 문구. 새로 고침 뒤 처음 받은 상태로는 알리지 않는다. */
export function turnCancelSettledNotice(previous: TurnCancelState | null | undefined, next: TurnCancelState | null | undefined): string | null {
  return isTurnCancelling(previous) && next === "rollback_failed" ? TURN_ROLLBACK_FAILED_DETAIL : null;
}
