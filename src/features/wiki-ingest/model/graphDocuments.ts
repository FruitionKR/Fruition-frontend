import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { filterTreeItems } from "@/entities/tree/lib/queries";
import { isMarkdownDocument } from "@/entities/document/lib/documentKind";
import { isWikiReflectEligible } from "./wikiReflectState";

export function isFailedPdfConversion(document: DocumentItemResponse): boolean {
  return document.status === "failed" && document.pipeline_run_id?.startsWith("convert:") === true;
}

/** 그래프 raw 노드와 위키 편입 트리는 Markdown만 대상이다. PDF는 우클릭 "Markdown으로 변환"으로만 변환한다. */
export function selectGraphDocuments(documents: DocumentItemResponse[]): DocumentItemResponse[] {
  return documents.filter((document) => isMarkdownDocument(document) && !isFailedPdfConversion(document));
}

export function filterGraphProjects(projects: Project[], documents: DocumentItemResponse[]): Project[] {
  const visibleIds = new Set(selectGraphDocuments(documents).map((document) => document.id));
  const keep = (item: TreeItem) => !item.documentId || visibleIds.has(item.documentId);
  return projects.map((project) => ({ ...project, items: filterTreeItems(project.items, keep) }));
}

export function isGraphIngestEligible(document: DocumentItemResponse): boolean {
  return isMarkdownDocument(document) && !isFailedPdfConversion(document) && isWikiReflectEligible(document);
}
