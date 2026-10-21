/**
 * 입력창에 포커스가 있을 때 Esc로 멈출 대상. 테스트가 직접 import하므로 다른 모듈을 import하지 않는다.
 *
 * 동시에 여럿이 진행 중이면 가장 나중에 시작한 것 하나만 멈춘다(Esc를 한 번 더 누르면 그다음 것).
 * - 보내기 전 스킬 실행: 앞선 작업·질문이 끝나기를 기다리는 카드라 늘 가장 나중에 시작한 것이다
 * - 이 화면이 따라가는 채팅 질의·작업: 진행 중이면 새 요청을 보낼 수 없어, 서버 기록의 다른 진행 중 요청보다 나중에 시작했다
 * - 서버 기록의 진행 중(pending) 작업·질의(새로 고침 뒤·다른 기기): 시작 시각이 가장 늦은 것
 */
export type ComposerStopTarget =
  | { kind: "skill-run" }
  | { kind: "query" }
  /** turnId가 null이면 서버가 아직 turn ID를 정하기 전이다. ID를 받으면 바로 취소를 요청한다. */
  | { kind: "following-turn"; turnId: string | null }
  | { kind: "pending-turn"; turnId: string }
  | { kind: "pending-query"; runId: string };

/** 서버 기록에서 아직 끝나지 않은 run. createdAt을 모르면 가장 오래된 것으로 본다. */
export type PendingStopCandidate = { runId: string; kind: "turn" | "query"; createdAt: string | null };

function startedAt(candidate: PendingStopCandidate): number {
  const time = candidate.createdAt ? Date.parse(candidate.createdAt) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function resolveComposerStopTarget({
  hasWaitingSkillRun,
  isQueryActive,
  isTurnFollowing,
  followingTurnId,
  pendingRuns,
  ignoredRunIds
}: {
  /** 스킬 화면에서 '다음'을 눌렀지만 아직 보내지 않은 실행이 있는지 */
  hasWaitingSkillRun: boolean;
  /** 이 화면이 채팅 질의 답변을 따라가는 중인지 */
  isQueryActive: boolean;
  /** 이 화면이 작업 turn을 따라가는 중인지 */
  isTurnFollowing: boolean;
  followingTurnId: string | null;
  pendingRuns: readonly PendingStopCandidate[];
  /** 이미 닫은(잠금을 푼) run. 멈출 대상이 아니다. */
  ignoredRunIds: ReadonlySet<string>;
}): ComposerStopTarget | null {
  if (hasWaitingSkillRun) return { kind: "skill-run" };
  if (isQueryActive) return { kind: "query" };
  if (isTurnFollowing) return { kind: "following-turn", turnId: followingTurnId };
  const latest = pendingRuns
    .filter((candidate) => !ignoredRunIds.has(candidate.runId))
    .reduce<PendingStopCandidate | null>((newest, candidate) => (!newest || startedAt(candidate) > startedAt(newest) ? candidate : newest), null);
  if (!latest) return null;
  return latest.kind === "turn" ? { kind: "pending-turn", turnId: latest.runId } : { kind: "pending-query", runId: latest.runId };
}

/** 멈출 대상이 있는 동안 입력창 아래에 보이는 안내 */
export function composerStopHint(target: ComposerStopTarget): string {
  if (target.kind === "skill-run") return "입력창에서 Esc를 누르면 스킬 실행을 취소합니다.";
  if (target.kind === "query" || target.kind === "pending-query") return "입력창에서 Esc를 누르면 질문을 취소합니다.";
  return "입력창에서 Esc를 누르면 작업을 중지합니다.";
}

/** Esc로 멈추는 동안 입력창 아래에 보이는 안내. 채팅 질의는 질의 쪽이 따로 안내한다. */
export function composerStoppingMessage(target: ComposerStopTarget | null): string | null {
  if (!target) return null;
  if (target.kind === "following-turn" || target.kind === "pending-turn") return "작업을 중지하는 중…";
  if (target.kind === "pending-query") return "질문을 취소하는 중…";
  return null;
}
