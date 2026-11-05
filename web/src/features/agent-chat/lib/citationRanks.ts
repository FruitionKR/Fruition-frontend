import type { ChatMessageReferenceResponse } from "@/entities/chat/model/chat";
import type { SourceBlockHighlight } from "@/entities/document/model/document";

/** 근거가 가리키는 문서. 대표 문서가 없으면 다중 문서 근거의 첫 문서를 쓴다. */
function citationDocumentId(reference: ChatMessageReferenceResponse): string | null {
  return reference.source_document_id ?? reference.source_refs?.[0]?.source_document_id ?? null;
}

/**
 * 인용을 누르면 열 문서와 강조할 블록. 첨부한 편집 문서처럼 블록이 없는 근거(source_block_ids가 빈 배열)는 강조 없이 문서만 연다.
 * 문서를 모르면 null이라 눌리지 않는 글자로 보인다.
 */
export function citationTarget(reference: ChatMessageReferenceResponse, rank: number): { documentId: string; highlights: SourceBlockHighlight[] } | null {
  const documentId = citationDocumentId(reference);
  if (!documentId) return null;
  return { documentId, highlights: [...new Set(reference.source_block_ids ?? [])].map((blockId) => ({ block_id: blockId, rank })) };
}

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

/**
 * 통합된 인용 번호별로 열 reference를 고른다.
 * 같은 번호에 여럿이 모이면 블록이 있는 reference를 먼저, 그다음 그 번호 자신의 reference를, 없으면 가장 작은 rank를 고른다(같으면 목록 순서).
 */
export function buildCitationReferenceByRank(
  references: ChatMessageReferenceResponse[],
  citationRankMap: ReadonlyMap<number, number>
): ReadonlyMap<number, ChatMessageReferenceResponse> {
  const canonicalOf = (rank: number) => citationRankMap.get(rank) ?? rank;
  const candidates = references
    .filter((item) => item.rank && citationDocumentId(item))
    .sort((a, b) => Number(!a.source_block_ids?.length) - Number(!b.source_block_ids?.length)
      || Number(a.rank !== canonicalOf(a.rank!)) - Number(b.rank !== canonicalOf(b.rank!))
      || a.rank! - b.rank!);
  const result = new Map<number, ChatMessageReferenceResponse>();
  for (const item of candidates) {
    const rank = canonicalOf(item.rank!);
    if (!result.has(rank)) result.set(rank, item);
  }
  return result;
}
