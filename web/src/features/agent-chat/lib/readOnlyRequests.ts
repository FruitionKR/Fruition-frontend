/**
 * 보기 권한 문서를 연 채 보낸 작업 turn과 그 문서를 보낸 사람의 브라우저(워크스페이스별 localStorage)에 적어 둔다. 읽고 쓰지 못하면 이번 화면에서만 기억한다.
 * 서버가 메시지에 read_only_document_id를 남기면 그 값을 쓰고, 이 기록은 그 값이 없는 메시지(필드 전에 보낸 요청, 구 서버)를 판단할 때만 쓴다.
 * 그런 메시지는 다른 브라우저에 기록이 없어 AI 원문이 보인다. 서버 값이 없는 요청이 남아 있는 한 지우지 않는다.
 */
export const READ_ONLY_REQUEST_LIMIT = 200;

const STORAGE_PREFIX = "fruition:read-only-requests";

export type ReadOnlyRequests = ReadonlyMap<string, string>;

type RequestStorage = Pick<Storage, "getItem" | "setItem">;

export function readOnlyRequestStorageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}`;
}

function isRequestEntry(entry: unknown): entry is [string, string] {
  return Array.isArray(entry) && typeof entry[0] === "string" && entry[0] !== "" && typeof entry[1] === "string" && entry[1] !== "";
}

export function readReadOnlyRequests(storage: RequestStorage | null, key: string): ReadOnlyRequests {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    return new Map(Array.isArray(parsed) ? parsed.filter(isRequestEntry).slice(-READ_ONLY_REQUEST_LIMIT) : []);
  } catch {
    return new Map();
  }
}

/** 맨 뒤(가장 최근)에 담은 새 기록. 한도를 넘으면 가장 오래된 것부터 뺀다. */
export function recordReadOnlyRequest(requests: ReadOnlyRequests, turnId: string, documentId: string): ReadOnlyRequests {
  return new Map([...requests, [turnId, documentId] as const].slice(-READ_ONLY_REQUEST_LIMIT));
}

export function writeReadOnlyRequest(storage: RequestStorage | null, key: string, turnId: string, documentId: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify([...recordReadOnlyRequest(readReadOnlyRequests(storage, key), turnId, documentId)]));
  } catch {
    // 이번 화면에서만 기억한다.
  }
}
