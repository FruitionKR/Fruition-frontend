import type { TreeItem } from "@/entities/tree";
import { collectTreeItems, filterTreeItems } from "@/entities/tree/lib/queries";
import { isMarkdownTreeItem, isPdfTreeItem } from "@/entities/document/lib/documentKind";

export { isMarkdownTreeItem };

/** 체크박스를 켤 수 있는 문서인지. 폴더·위키 노드·반영 불가 문서는 false. */
export function isSelectableTreeItem(item: TreeItem, eligibleDocumentIds: ReadonlySet<string>): boolean {
  return (
    item.type === "file"
    && item.documentId !== undefined
    && (isMarkdownTreeItem(item) || isPdfTreeItem(item))
    && eligibleDocumentIds.has(item.documentId)
  );
}

/**
 * 선택 모드에 보여줄 트리. 반영할 수 없는 문서(TXT·처리 중·이미 반영됨)는 숨기고,
 * 선택 가능한 문서가 하나도 없는 폴더도 함께 숨긴다.
 */
export function pruneIneligibleTreeItems(items: TreeItem[], eligibleDocumentIds: ReadonlySet<string>): TreeItem[] {
  return filterTreeItems(items, (item) =>
    item.type === "file"
      ? isSelectableTreeItem(item, eligibleDocumentIds)
      : collectSelectableDocumentIds(item.children ?? [], eligibleDocumentIds).length > 0
  );
}

/** 항목 자신과 하위 트리에서 선택 가능한 문서 id를 모두 모은다. 폴더 체크 시 일괄 선택 단위가 된다. */
export function collectSelectableDocumentIds(
  items: TreeItem[],
  eligibleDocumentIds: ReadonlySet<string>
): string[] {
  return collectTreeItems(items, (item) =>
    item.documentId !== undefined && isSelectableTreeItem(item, eligibleDocumentIds) ? item.documentId : undefined
  );
}

/** 대상 id가 하나 이상 있고 전부 선택돼 있을 때만 체크 상태로 본다. */
export function isAllSelected(selected: ReadonlySet<string>, ids: string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** 전부 선택돼 있으면 해제하고, 아니면 전부 선택한 새 Set을 돌려준다. */
export function toggleDocumentIds(selected: ReadonlySet<string>, ids: string[]): ReadonlySet<string> {
  const next = new Set(selected);
  const shouldClear = isAllSelected(selected, ids);
  ids.forEach((id) => (shouldClear ? next.delete(id) : next.add(id)));
  return next;
}
