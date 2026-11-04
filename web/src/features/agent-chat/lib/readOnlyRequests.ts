/**
 * 보기 권한 문서를 연 채 보낸 작업 turn과 그 문서. 보기 권한 문서는 편집 문맥 없이 요청이 나가 서버 기록에 문서가 남지 않으므로,
 * 보낸 사람의 브라우저(워크스페이스별 localStorage)에 적어 둔다. 읽고 쓰지 못하면 이번 화면에서만 기억한다.
 * AI의 이유 코드(clarify_reason)는 편집 문맥이 없었다는 뜻뿐이라 문서를 안 연 요청과 구별하지 못하므로 코드가 있어도 이 기록이 필요하다.
 * 서버가 요청 때의 보기 전용 문서를 메시지에 남기면 그때 지울 수 있다. 그전까지 다른 브라우저에는 기록이 없어 AI 원문이 보인다.
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
