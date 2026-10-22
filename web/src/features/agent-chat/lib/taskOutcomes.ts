/**
 * 작업 탭에서 이 사람이 편집안·새 문서 초안을 어떻게 끝냈는지(저장·거절·취소) turn별로 기억한다.
 * 새로 고침 뒤에도 완료 행이 "제안 완료"로 돌아가지 않게 하는 보는 사람 한 명의 편의 기록이라
 * localStorage(워크스페이스·대화 세션별)에만 두고, 읽고 쓰지 못하면 이번 화면에서만 기억한다.
 * 서버 버전 기록으로 확인하는 "저장됨"(useServerAppliedTurnIds)은 그대로 따로 본다.
 */
export type TaskOutcome = "applied" | "rejected" | "cancelled";

/** 세션마다 최근 turn을 이만큼만 남긴다. */
export const TASK_OUTCOME_LIMIT = 200;

const STORAGE_PREFIX = "fruition:task-outcomes";
const OUTCOMES: ReadonlySet<string> = new Set<TaskOutcome>(["applied", "rejected", "cancelled"]);

export type TaskOutcomes = ReadonlyMap<string, TaskOutcome>;

type OutcomeStorage = Pick<Storage, "getItem" | "setItem">;

export function taskOutcomeStorageKey(workspaceId: string, sessionId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}:${sessionId}`;
}

/** 저장된 문자열 → turn별 결과. 형식이 다르거나 깨졌으면 빈 기록으로 본다. 오래된 것부터 담겨 있다. */
export function parseTaskOutcomes(raw: string | null): TaskOutcomes {
  if (!raw) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const entries = parsed.filter(
      (entry): entry is [string, TaskOutcome] =>
        Array.isArray(entry) && typeof entry[0] === "string" && entry[0] !== "" && OUTCOMES.has(entry[1])
    );
    return new Map(entries.slice(-TASK_OUTCOME_LIMIT));
  } catch {
    return new Map();
  }
}

/** turn 결과를 맨 뒤(가장 최근)에 담은 새 기록. 한도를 넘으면 가장 오래된 것부터 뺀다. */
export function recordTaskOutcome(outcomes: TaskOutcomes, turnId: string, outcome: TaskOutcome): TaskOutcomes {
  const entries = [...outcomes].filter(([id]) => id !== turnId);
  entries.push([turnId, outcome]);
  return new Map(entries.slice(-TASK_OUTCOME_LIMIT));
}

/** 두 기록을 합친다. 같은 turn은 next 값을 쓴다. */
export function mergeTaskOutcomes(base: TaskOutcomes, next: TaskOutcomes): TaskOutcomes {
  let merged = base;
  for (const [turnId, outcome] of next) merged = recordTaskOutcome(merged, turnId, outcome);
  return merged;
}

export function readTaskOutcomes(storage: OutcomeStorage | null, key: string): TaskOutcomes {
  try {
    return parseTaskOutcomes(storage?.getItem(key) ?? null);
  } catch {
    return new Map();
  }
}

/** 저장소의 기록에 turn 결과를 더해 다시 쓴다. 쓰지 못하면(사생활 보호 모드·용량 초과) 조용히 넘긴다. */
export function writeTaskOutcome(storage: OutcomeStorage | null, key: string, turnId: string, outcome: TaskOutcome): void {
  if (!storage) return;
  try {
    const next = recordTaskOutcome(readTaskOutcomes(storage, key), turnId, outcome);
    storage.setItem(key, JSON.stringify([...next]));
  } catch {
    // 이번 화면에서만 기억한다.
  }
}

/** 브라우저 localStorage. 접근만으로 예외가 나는 환경이면 null. */
export function browserTaskOutcomeStorage(): OutcomeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 기록에서 한 가지 결과의 turn만 모은다. */
export function turnIdsWithOutcome(outcomes: TaskOutcomes, outcome: TaskOutcome): ReadonlySet<string> {
  return new Set([...outcomes].filter(([, value]) => value === outcome).map(([turnId]) => turnId));
}
