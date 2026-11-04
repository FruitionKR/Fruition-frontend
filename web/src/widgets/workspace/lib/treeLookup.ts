import { findItemLocation } from "@/entities/tree/lib/treeNames";
import { findTreeItemByDocumentId } from "@/entities/tree/lib/treeQueries";
import type { Project, TreeItem } from "@/entities/tree/model/tree";

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

/** 문서가 있는 폴더. 루트면 null, 트리에 없으면 undefined. */
export function findDocumentFolderId(projects: Project[], documentId: string): string | null | undefined {
  const item = findTreeItemInProjects(projects, documentId);
  const location = item ? findItemLocation(projects, item.id) : undefined;
  if (!location) return undefined;
  return location.folderId ?? projects.find((project) => project.id === location.projectId)?.folderId ?? null;
}

export function findFirstSelectableNote(items: TreeItem[], documentIds: Set<string>): TreeItem | null {
  for (const item of items) {
    if (item.documentId && documentIds.has(item.documentId)) return item;
    const nested = item.children?.length ? findFirstSelectableNote(item.children, documentIds) : null;
    if (nested) return nested;
  }
  return null;
}
