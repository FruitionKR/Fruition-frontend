import { findSourceNodeByDocumentId } from "@/entities/graph/lib/graph";
import { formatReferenceMeta, formatWikiPageTitle } from "./agentFormatters";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";
import type { GraphNode } from "@/entities/wiki/model/wiki";

const MAX_RESULT_CARDS = 3;

export function findGraphNode(nodes: GraphNode[] | undefined, pageId: string) {
  return nodes?.find((node) => node.id === pageId);
}

function isKnownPage(nodes: GraphNode[] | undefined, pageId: string) {
  return !nodes || !!findGraphNode(nodes, pageId);
}

export function buildRelatedPageCards(message: ChatMessageResponse, nodes: GraphNode[] | undefined) {
  const relatedPages = message.related_pages ?? [];
  if (relatedPages.length > 0) {
    return relatedPages
      .filter((page) => isKnownPage(nodes, page.wiki_page_id))
      .slice(0, MAX_RESULT_CARDS)
      .map((page) => ({
        key: `related-${page.wiki_page_id}`,
        pageId: page.wiki_page_id,
        pageType: page.page_type,
        title: findGraphNode(nodes, page.wiki_page_id)?.label ?? page.title,
        meta: page.role || "관련 자료"
      }));
  }

  const seenPageIds = new Set<string>();
  return message.references
    .map((reference) => ({
      reference,
      pageId: reference.source_document_id
        ? findSourceNodeByDocumentId(nodes, reference.source_document_id)?.id ?? null
        : null
    }))
    .filter(({ pageId }) => {
      if (!pageId || seenPageIds.has(pageId)) return false;
      seenPageIds.add(pageId);
      return true;
    })
    .slice(0, MAX_RESULT_CARDS)
    .map(({ reference, pageId }) => ({
      key: `reference-${reference.id}`,
      pageId: pageId as string,
      pageType: "source",
      title: formatWikiPageTitle(pageId as string, nodes, reference.source_document_id || "근거"),
      meta: formatReferenceMeta(reference)
    }));
}

export function sourceTitle(nodes: GraphNode[] | undefined, documentId: string) {
  return findSourceNodeByDocumentId(nodes, documentId)?.label ?? documentId;
}
