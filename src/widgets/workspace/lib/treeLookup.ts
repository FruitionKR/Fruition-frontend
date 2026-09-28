import { findTreeItemByDocumentId } from "@/entities/tree/lib/queries";
import type { TreeItem } from "@/entities/tree/model/tree";

export function findParentLabel(items: TreeItem[], itemId: string, parentLabel: string): string | null {
  for (const item of items) {
    if (item.id === itemId) return parentLabel;
    const nestedLabel = item.children?.length
      ? findParentLabel(item.children, itemId, item.label)
      : null;
    if (nestedLabel) return nestedLabel;
  }
  return null;
}

export function findTreeItemInProjects(projects: ReadonlyArray<{ items: TreeItem[] }>, documentId: string): TreeItem | null {
  for (const project of projects) {
    const item = findTreeItemByDocumentId(project.items, documentId);
    if (item) return item;
  }
  return null;
}

export function findFirstSelectableNote(items: TreeItem[], documentIds: Set<string>): TreeItem | null {
  for (const item of items) {
    if ((item.documentId && documentIds.has(item.documentId)) || (!item.documentId && item.graphNodeId)) return item;
    const nested = item.children?.length ? findFirstSelectableNote(item.children, documentIds) : null;
    if (nested) return nested;
  }
  return null;
}
