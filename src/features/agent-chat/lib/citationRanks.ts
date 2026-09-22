import type { ChatMessageReferenceResponse } from "@/entities/chat/model/chat";

/** 원문 문서와 블록 집합이 완전히 같을 때만 가장 작은 인용 번호로 통합한다. */
export function buildCitationRankMap(references: ChatMessageReferenceResponse[]): ReadonlyMap<number, number> {
  const keysByRank = new Map<number, Set<string>>();
  for (const reference of references) {
    const rank = reference.rank;
    if (!rank || !Number.isInteger(rank) || rank < 1) continue;
    const blocks = reference.source_block_ids;
    // 다중 문서 근거가 있으면 대표 문서 밖의 블록까지 비교한다.
    const locations = [
      ...(blocks ?? []).map((block) => JSON.stringify([reference.source_document_id, block])),
      ...(reference.source_refs ?? []).map((source) => JSON.stringify([source.source_document_id, source.source_block_id]))
    ];
    const key = reference.source_document_id && blocks?.length
      ? JSON.stringify([reference.source_document_id, [...new Set(locations)].sort()])
      : `unresolved:${reference.id}`;
    const keys = keysByRank.get(rank) ?? new Set<string>();
    keys.add(key);
    keysByRank.set(rank, keys);
  }

  const canonicalByKey = new Map<string, number>();
  const result = new Map<number, number>();
  for (const rank of [...keysByRank.keys()].sort((a, b) => a - b)) {
    const keys = keysByRank.get(rank)!;
    // 같은 번호에 서로 다른 근거가 연결된 경우 임의로 합치지 않는다.
    if (keys.size !== 1) continue;
    const key = [...keys][0];
    if (key.startsWith("unresolved:")) continue;
    const canonical = canonicalByKey.get(key) ?? rank;
    canonicalByKey.set(key, canonical);
    result.set(rank, canonical);
  }
  return result;
}
