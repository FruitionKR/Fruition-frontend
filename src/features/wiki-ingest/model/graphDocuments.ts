import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { filterTreeItems } from "@/entities/tree/lib/queries";
import { isDocumentConverting, isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";
import { getWikiReflectState, isWikiReflectEligible } from "./wikiReflectState";

export function isFailedPdfConversion(document: DocumentItemResponse): boolean {
  return document.status === "failed" && document.pipeline_run_id?.startsWith("convert:") === true;
}

/** 그래프 raw 노드는 Markdown만 대상이다. PDF 원본은 그래프에 표시하지 않는다. */
export function selectGraphDocuments(documents: DocumentItemResponse[]): DocumentItemResponse[] {
  return documents.filter((document) => isMarkdownDocument(document) && !isFailedPdfConversion(document));
}

export function filterGraphProjects(projects: Project[], documents: DocumentItemResponse[]): Project[] {
  const visibleIds = new Set(selectGraphDocuments(documents).map((document) => document.id));
  const keep = (item: TreeItem) => !item.documentId || visibleIds.has(item.documentId);
  return projects.map((project) => ({ ...project, items: filterTreeItems(project.items, keep) }));
}

/** 위키 편입 선택 트리에서 고를 수 없는 이유. 체크박스 툴팁·보조 설명으로 보여준다. */
export const GRAPH_INGEST_BLOCK_REASONS = {
  notMarkdown: "Markdown 문서만 위키에 편입할 수 있어요",
  pdfConverted: "이미 Markdown으로 변환했어요. 변환된 Markdown 문서를 선택해 주세요",
  pdfConverting: "Markdown으로 변환하는 중이에요",
  conversionFailed: "Markdown 변환에 실패한 문서예요",
  processing: "처리 중이라 지금은 편입할 수 없어요",
  upToDate: "이미 최신 내용이 위키에 반영돼 있어요"
} as const;

/**
 * 위키 편입 선택 트리에서 문서를 고를 수 없는 이유. 고를 수 있으면 null.
 * - Markdown: 처리 중이거나 이미 최신으로 반영된 문서, 변환에 실패한 문서는 막는다.
 * - PDF: 아직 변환하지 않은 원본만 고를 수 있다(확인 후 Markdown으로 변환해 편입).
 *   변환본(source_document_id로 연결된 Markdown)이 있거나 변환 중이면 막는다. 실패한 변환본은 없는 것으로 본다.
 * - 그 밖의 파일(TXT 등)은 고를 수 없다.
 */
export function getGraphIngestBlockReason(
  document: DocumentItemResponse,
  documents: DocumentItemResponse[]
): string | null {
  if (isPdfDocument(document)) {
    const converted = documents.filter((item) =>
      item.source_document_id === document.id && isMarkdownDocument(item) && !isFailedPdfConversion(item)
    );
    if (converted.some(isDocumentConverting)) return GRAPH_INGEST_BLOCK_REASONS.pdfConverting;
    if (converted.length > 0) return GRAPH_INGEST_BLOCK_REASONS.pdfConverted;
    return getWikiReflectState(document) === "processing" ? GRAPH_INGEST_BLOCK_REASONS.processing : null;
  }
  if (!isMarkdownDocument(document)) return GRAPH_INGEST_BLOCK_REASONS.notMarkdown;
  if (isFailedPdfConversion(document)) return GRAPH_INGEST_BLOCK_REASONS.conversionFailed;
  if (isDocumentConverting(document)) return GRAPH_INGEST_BLOCK_REASONS.pdfConverting;
  if (isWikiReflectEligible(document)) return null;
  return getWikiReflectState(document) === "processing"
    ? GRAPH_INGEST_BLOCK_REASONS.processing
    : GRAPH_INGEST_BLOCK_REASONS.upToDate;
}

export function isGraphIngestEligible(document: DocumentItemResponse, documents: DocumentItemResponse[]): boolean {
  return getGraphIngestBlockReason(document, documents) === null;
}
