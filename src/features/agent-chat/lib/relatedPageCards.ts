import { findSourceNodeByDocumentId, makeRawId } from "@/entities/graph/lib/graph";
import type { ChatMessageReferenceResponse, ChatMessageResponse } from "@/entities/chat/model/chat";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import type { GraphNode } from "@/entities/wiki/model/wiki";

export type SourceDocumentCard = {
  key: string;
  documentId: string;
  title: string;
  meta: string;
  /** 누르면 원본을 열고 강조할 근거 block */
  highlights: SourceBlockHighlight[];
};

const UNRANKED = Number.MAX_SAFE_INTEGER;

/** 근거 하나가 가리키는 (문서, block) 쌍. source_refs(다중 문서)를 우선하고 legacy 대표 문서 필드를 더한다. */
function referenceLocations(reference: ChatMessageReferenceResponse): { documentId: string; blockId: string | null }[] {
  const fromRefs = (reference.source_refs ?? []).map((ref) => ({ documentId: ref.source_document_id, blockId: ref.source_block_id }));
  const legacyDocumentId = reference.source_document_id;
  const fromLegacy = legacyDocumentId
    ? (reference.source_block_ids?.length ? reference.source_block_ids : [null]).map((blockId) => ({ documentId: legacyDocumentId, blockId }))
    : [];
  return [...fromRefs, ...fromLegacy];
}

/**
 * "찾은 자료": 답변 근거(references)로 쓰인 원본 문서를 rank 순서로 하나씩 모은다.
 * related_pages는 위키(concept 등) 페이지라 원본이 아니므로 쓰지 않는다.
 * 그래프에 raw 노드가 없는 문서(삭제됨 등)는 열 수 없어 뺀다.
 */
export function buildSourceDocumentCards(message: ChatMessageResponse, nodes: GraphNode[] | undefined): SourceDocumentCard[] {
  const sorted = [...message.references].sort((a, b) => (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED));
  const cards = new Map<string, SourceDocumentCard>();
  for (const reference of sorted) {
    for (const { documentId, blockId } of referenceLocations(reference)) {
      const title = nodes
        ? nodes.find((node) => node.id === makeRawId(documentId))?.label
        : documentId;
      if (!title) continue;
      const card = cards.get(documentId) ?? { key: `source-${documentId}`, documentId, title, meta: reference.text || "근거 원본", highlights: [] };
      const isNewBlock = blockId !== null && !card.highlights.some((item) => item.block_id === blockId);
      cards.set(documentId, isNewBlock
        ? { ...card, highlights: [...card.highlights, { block_id: blockId, rank: reference.rank ?? 0 }] }
        : card);
    }
  }
  return [...cards.values()];
}

export function sourceTitle(nodes: GraphNode[] | undefined, documentId: string) {
  return findSourceNodeByDocumentId(nodes, documentId)?.label ?? documentId;
}
