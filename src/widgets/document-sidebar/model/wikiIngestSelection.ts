import type { TreeItem } from "@/entities/tree";

/** 위키 편입은 마크다운 문서만 대상으로 한다. PDF/TXT 원본은 체크할 수 없다. */
export function isMarkdownTreeItem(item: TreeItem): boolean {
  if (item.mimeType?.includes("markdown")) return true;
  return item.label.toLowerCase().endsWith(".md");
}

/** 체크박스를 켤 수 있는 문서인지. 폴더·위키 노드·반영 불가 문서는 false. */
export function isSelectableTreeItem(item: TreeItem, eligibleDocumentIds: ReadonlySet<string>): boolean {
  return (
    item.type === "file"
    && item.documentId !== undefined
    && isMarkdownTreeItem(item)
    && eligibleDocumentIds.has(item.documentId)
  );
}

/** 항목 자신과 하위 트리에서 선택 가능한 문서 id를 모두 모은다. 폴더 체크 시 일괄 선택 단위가 된다. */
export function collectSelectableDocumentIds(
  items: TreeItem[],
  eligibleDocumentIds: ReadonlySet<string>
): string[] {
  return items.flatMap((item) =>
    item.documentId !== undefined && isSelectableTreeItem(item, eligibleDocumentIds)
      ? [item.documentId]
      : collectSelectableDocumentIds(item.children ?? [], eligibleDocumentIds)
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
