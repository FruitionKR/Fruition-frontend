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
