/**
 * 첨부를 실은 작업 turn과 그 문서 ID를 보낸 사람의 브라우저(워크스페이스별 localStorage)에 적어 둔다.
 * 서버 메시지에는 첨부가 남지 않으므로, 작업 탭이 돌려보낸 질문을 새로 고침 뒤에도 첨부와 함께 채팅 탭으로 옮기는 데 쓴다.
 * 읽고 쓰지 못하면 이번 화면에서만 기억한다.
 */
const TURN_REFERENCE_LIMIT = 200;
const STORAGE_PREFIX = "fruition:turn-references";

export type TurnReferences = ReadonlyMap<string, readonly string[]>;

type ReferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function turnReferenceStorageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}`;
}

function isReferenceEntry(entry: unknown): entry is [string, string[]] {
  return Array.isArray(entry) && typeof entry[0] === "string" && entry[0] !== ""
    && Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string" && id !== "");
}

export function readTurnReferences(storage: ReferenceStorage | null, key: string): TurnReferences {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    return new Map(Array.isArray(parsed) ? parsed.filter(isReferenceEntry).slice(-TURN_REFERENCE_LIMIT) : []);
  } catch {
    return new Map();
  }
}

/** 맨 뒤(가장 최근)에 담은 새 기록. 한도를 넘으면 가장 오래된 것부터 뺀다. */
export function recordTurnReferences(references: TurnReferences, turnId: string, documentIds: readonly string[]): TurnReferences {
  return new Map([...references, [turnId, documentIds] as const].slice(-TURN_REFERENCE_LIMIT));
}

export function writeTurnReferences(storage: ReferenceStorage | null, key: string, turnId: string, documentIds: readonly string[]): void {
  if (!storage || documentIds.length === 0) return;
  try {
    storage.setItem(key, JSON.stringify([...recordTurnReferences(readTurnReferences(storage, key), turnId, documentIds)]));
  } catch {
    // 이번 화면에서만 기억한다.
  }
}
