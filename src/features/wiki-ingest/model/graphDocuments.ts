import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { filterTreeItems } from "@/entities/tree/lib/queries";
import { isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";
import { getWikiReflectState, isWikiReflectEligible } from "./wikiReflectState";

export { isMarkdownDocument, isPdfDocument };

export function isFailedPdfConversion(document: DocumentItemResponse): boolean {
  return document.status === "failed" && document.pipeline_run_id?.startsWith("convert:") === true;
}

/** 그래프에서는 변환본이 있으면 PDF 원본 대신 Markdown을 표시한다. 실패한 변환은 PDF로 재시도한다. */
export function selectGraphDocuments(documents: DocumentItemResponse[]): DocumentItemResponse[] {
  const convertedSourceIds = new Set(documents
    .filter((document) => isMarkdownDocument(document) && !isFailedPdfConversion(document))
    .map((document) => document.source_document_id)
    .filter(Boolean));
  return documents.filter((document) =>
    !isFailedPdfConversion(document) && !(isPdfDocument(document) && convertedSourceIds.has(document.id))
  );
}

export function filterGraphProjects(projects: Project[], documents: DocumentItemResponse[]): Project[] {
  const visibleIds = new Set(selectGraphDocuments(documents).map((document) => document.id));
  const keep = (item: TreeItem) => !item.documentId || visibleIds.has(item.documentId);
  return projects.map((project) => ({ ...project, items: filterTreeItems(project.items, keep) }));
}

export function isGraphIngestEligible(document: DocumentItemResponse): boolean {
  if (isPdfDocument(document)) return getWikiReflectState(document) !== "processing";
  return isMarkdownDocument(document) && !isFailedPdfConversion(document) && isWikiReflectEligible(document);
}
