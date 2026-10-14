import type { TreeItem } from "@/entities/tree/model/tree";

export function findTreeItem(items: TreeItem[], itemId: string): TreeItem | null {
  for (const item of items) {
    if (item.id === itemId) return item;
    const found = item.children ? findTreeItem(item.children, itemId) : null;
    if (found) return found;
  }
  return null;
}

export function findTreeItemByDocumentId(items: TreeItem[], documentId: string): TreeItem | null {
  for (const item of items) {
    if (item.documentId === documentId) return item;
    const found = item.children ? findTreeItemByDocumentId(item.children, documentId) : null;
    if (found) return found;
  }
  return null;
}

export function findTreeItemByGraphNodeId(items: TreeItem[], graphNodeId: string): TreeItem | null {
  for (const item of items) {
    if (item.graphNodeId === graphNodeId) return item;
    const found = item.children ? findTreeItemByGraphNodeId(item.children, graphNodeId) : null;
    if (found) return found;
  }
  return null;
}

/** keep이 참인 항목만 남기며 하위 트리도 같은 기준으로 재구성한다. */
export function filterTreeItems(items: TreeItem[], keep: (item: TreeItem) => boolean): TreeItem[] {
  return items.flatMap((item) => {
    if (!keep(item)) return [];
    return item.children ? [{ ...item, children: filterTreeItems(item.children, keep) }] : [item];
  });
}

/** 트리를 순회하며 pick이 값을 돌려준 항목만 모은다. */
export function collectTreeItems<T>(items: TreeItem[], pick: (item: TreeItem) => T | undefined): T[] {
  return items.flatMap((item) => {
    const picked = pick(item);
    const rest = item.children ? collectTreeItems(item.children, pick) : [];
    return picked === undefined ? rest : [picked, ...rest];
  });
}
