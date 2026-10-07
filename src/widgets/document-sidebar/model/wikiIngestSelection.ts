import type { TreeItem } from "@/entities/tree";
import { collectTreeItems } from "@/entities/tree/lib/queries";
import { isMarkdownTreeItem } from "@/entities/document/lib/documentKind";

export { isMarkdownTreeItem };

/** 문서 id별로 위키 편입 선택을 막는 이유. null이면 고를 수 있다. */
export type IngestBlockReasons = ReadonlyMap<string, string | null>;

/** 문서 목록에 아직 없는 항목(업로드 중 등)을 고를 수 없는 이유 */
export const INGEST_UNAVAILABLE_REASON = "아직 편입할 수 없는 파일이에요";

/** 파일 행을 고를 수 없는 이유. 고를 수 있으면 null, 폴더는 대상이 아니라 null이다. */
export function getTreeItemBlockReason(item: TreeItem, reasons: IngestBlockReasons): string | null {
  if (item.type !== "file") return null;
  if (item.documentId === undefined) return INGEST_UNAVAILABLE_REASON;
  const reason = reasons.get(item.documentId);
  return reason === undefined ? INGEST_UNAVAILABLE_REASON : reason;
}

/** 체크박스를 켤 수 있는 파일인지. 폴더·위키 노드·편입할 수 없는 파일은 false. */
export function isSelectableTreeItem(item: TreeItem, reasons: IngestBlockReasons): boolean {
  return item.type === "file" && getTreeItemBlockReason(item, reasons) === null;
}

/**
 * 폴더 체크 시 한꺼번에 고를 문서 id. 하위 폴더까지 내려가 선택 가능한 Markdown만 모은다.
 * 변환 전 PDF는 변환 확인이 필요해 폴더 일괄 선택에 넣지 않고 행에서 직접 고른다.
 */
export function collectFolderMarkdownIds(items: TreeItem[], reasons: IngestBlockReasons): string[] {
  return collectTreeItems(items, (item) =>
    item.documentId !== undefined && isSelectableTreeItem(item, reasons) && isMarkdownTreeItem(item)
      ? item.documentId
      : undefined
  );
}

export type SelectionState = "checked" | "mixed" | "unchecked";

/** 대상 id가 모두 선택되면 checked, 일부만 선택되면 mixed(indeterminate). 대상이 없으면 unchecked. */
export function getSelectionState(selected: ReadonlySet<string>, ids: string[]): SelectionState {
  const count = ids.filter((id) => selected.has(id)).length;
  if (count === 0) return "unchecked";
  return count === ids.length ? "checked" : "mixed";
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
