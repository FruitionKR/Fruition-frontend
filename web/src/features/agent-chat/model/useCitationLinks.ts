import { useCallback, useMemo } from "react";
import type { ChatMessageReferenceResponse } from "@/entities/chat/model/chat";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import type { GraphNode } from "@/entities/wiki/model/wiki";
import { captureAnalytics } from "@/shared/lib/analytics/client";
import { buildCitationRankMap, buildCitationReferenceByRank, citationTarget } from "../lib/citationRanks";
import { sourceTitle } from "../lib/relatedPageCards";

/** 답변 본문의 인용 번호를 근거 문서로 잇는다. MarkdownViewer에 그대로 넘기는 값이다. */
export function useCitationLinks({
  references,
  runId,
  nodes,
  onOpenSourceBlocks
}: {
  references: ChatMessageReferenceResponse[];
  runId: string | null | undefined;
  nodes: GraphNode[] | undefined;
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
}) {
  const citationRankMap = useMemo(() => buildCitationRankMap(references), [references]);
  // 본문의 숫자 괄호는 모두 이 rank일 때만 citation이 된다(숫자 배열 오인 방지).
  const citableRanks = useMemo(
    () => new Set(references.flatMap((item) => item.rank && Number.isInteger(item.rank) && item.rank >= 1 ? [item.rank] : [])),
    [references]
  );
  const citationReferenceByRank = useMemo(() => buildCitationReferenceByRank(references, citationRankMap), [references, citationRankMap]);
  // MarkdownViewer가 memo라 콜백 identity를 고정해야 폴링 리렌더마다 본문을 다시 그리지 않는다.
  const canClickCitation = useCallback((rank: number) => citationReferenceByRank.has(rank), [citationReferenceByRank]);
  const onCitationClick = useCallback((rank: number) => {
    const reference = citationReferenceByRank.get(rank);
    const target = reference ? citationTarget(reference, rank) : null;
    if (!target) return;
    if (runId) captureAnalytics("citation_opened", { query_id: runId, rank, citation_type: "internal", document_id: target.documentId });
    onOpenSourceBlocks(target.documentId, sourceTitle(nodes, target.documentId), target.highlights);
  }, [citationReferenceByRank, nodes, onOpenSourceBlocks, runId]);
  return { citationRankMap, citableRanks, canClickCitation, onCitationClick };
}
