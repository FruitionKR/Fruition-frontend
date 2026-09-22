import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { getWikiReflectState, isWikiReflectEligible } from "./wikiReflectState";

export function isPdfDocument(document: DocumentItemResponse): boolean {
  return document.mime_type === "application/pdf" || /\.pdf$/i.test(document.filename);
}

export function isMarkdownDocument(document: DocumentItemResponse): boolean {
  return document.document_role === "EDITABLE"
    && (document.mime_type.includes("markdown") || /\.(md|markdown)$/i.test(document.filename));
}

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
  const filterItems = (items: TreeItem[]): TreeItem[] => items
    .filter((item) => !item.documentId || visibleIds.has(item.documentId))
    .map((item) => item.children ? { ...item, children: filterItems(item.children) } : item);
  return projects.map((project) => ({ ...project, items: filterItems(project.items) }));
}

export function isGraphIngestEligible(document: DocumentItemResponse): boolean {
  if (isPdfDocument(document)) return getWikiReflectState(document) !== "processing";
  return isMarkdownDocument(document) && !isFailedPdfConversion(document) && isWikiReflectEligible(document);
}
