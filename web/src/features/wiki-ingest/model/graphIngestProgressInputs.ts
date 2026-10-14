import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting } from "@/entities/document/lib/documentKind";
import { makeRawId } from "@/entities/graph/lib/graphBuilder";
import { getWikiReflectState } from "./wikiReflectState";

/**
 * 그래프 생성 중 진행률 링에 넘기는 문서 상태.
 * processing: 위키 편입 중(진행률 표시), failed: 편입 실패(채우지 않고 바로 일반 노드로).
 * 완료는 목록에서 빠지는 것으로 전달한다.
 */
export type GraphIngestProgressInput =
  | { nodeId: string; status: "processing"; startedAt: string | undefined }
  | { nodeId: string; status: "failed" };

/** 문서 목록에서 위키 편입 중·실패 문서만 raw 노드 기준 입력으로 만든다. PDF 변환 중 문서는 편입이 아니라 제외한다. */
export function selectGraphIngestProgressInputs(documents: DocumentItemResponse[]): GraphIngestProgressInput[] {
  return documents.flatMap((document): GraphIngestProgressInput[] => {
    const nodeId = makeRawId(document.id);
    if (getWikiReflectState(document) === "processing") {
      if (isDocumentConverting(document)) return [];
      return [{ nodeId, status: "processing", startedAt: document.processing_started_at }];
    }
    return document.status === "failed" ? [{ nodeId, status: "failed" }] : [];
  });
}
