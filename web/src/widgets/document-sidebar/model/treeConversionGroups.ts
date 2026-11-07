import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting, isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";
import type { TreeItem } from "@/entities/tree/model/tree";
import { isFailedConversion, type TreeConversionBadge } from "./treeConversionBadge";

/** 원본 PDF 행 아래에 묶어 그리는 변환본 행 */
export type TreeConversionChild = {
  item: TreeItem;
  /** 아직 변환 중인 변환본(변환 결과 placeholder)이면 true */
  isConverting: boolean;
};

/**
 * 트리 표시용 PDF ↔ 변환본 묶음. 실제 폴더 위치(트리 데이터)는 바꾸지 않고 그릴 때만 쓴다.
 * 원본 PDF와 같은 폴더(형제 목록)에 있는 변환본만 묶는다.
 */
export type TreeConversionGroups = {
  /** 원본 PDF 행 id → 그 아래에 그릴 변환본 행(트리 순서) */
  childrenBySourceId: ReadonlyMap<string, readonly TreeConversionChild[]>;
  /** 원본 PDF 아래로 옮겨 그려 원래 자리에서는 그리지 않는 변환본 행 id */
  groupedIds: ReadonlySet<string>;
};

export const EMPTY_TREE_CONVERSION_GROUPS: TreeConversionGroups = { childrenBySourceId: new Map(), groupedIds: new Set() };

/**
 * 형제 목록마다 원본 PDF와 그 변환본을 짝짓는다.
 * - 변환본은 source_document_id로 원본을 가리키는 Markdown이다. 변환에 실패한 변환본은 없는 것으로 보고 제자리에 둔다.
 * - 원본이 다른 폴더에 있거나 삭제·권한 때문에 목록에 없으면 묶지 않고 제자리에 둔다.
 */
export function buildTreeConversionGroups(
  items: readonly TreeItem[],
  documents: readonly DocumentItemResponse[]
): TreeConversionGroups {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const childrenBySourceId = new Map<string, TreeConversionChild[]>();
  const groupedIds = new Set<string>();

  const visit = (siblings: readonly TreeItem[]) => {
    // 같은 형제 목록 안의 원본 PDF 행만 짝이 될 수 있다.
    const pdfItemByDocumentId = new Map<string, TreeItem>();
    for (const item of siblings) {
      const document = item.documentId ? documentById.get(item.documentId) : undefined;
      if (item.type === "file" && document && isPdfDocument(document)) pdfItemByDocumentId.set(document.id, item);
    }
    for (const item of siblings) {
      if (item.children) visit(item.children);
      const document = item.documentId ? documentById.get(item.documentId) : undefined;
      if (item.type !== "file" || !document?.source_document_id) continue;
      if (!isMarkdownDocument(document) || isFailedConversion(document)) continue;
      const source = pdfItemByDocumentId.get(document.source_document_id);
      if (!source) continue;
      childrenBySourceId.set(source.id, [
        ...(childrenBySourceId.get(source.id) ?? []),
        { item, isConverting: isDocumentConverting(document) }
      ]);
      groupedIds.add(item.id);
    }
  };
  visit(items);

  if (groupedIds.size === 0) return EMPTY_TREE_CONVERSION_GROUPS;
  return { childrenBySourceId, groupedIds };
}

/** 형제 목록에서 원본 PDF 아래로 옮겨 그리는 변환본을 뺀다. */
export function ungroupedTreeRows(items: readonly TreeItem[], groups: TreeConversionGroups): readonly TreeItem[] {
  if (groups.groupedIds.size === 0) return items;
  return items.filter((item) => !groups.groupedIds.has(item.id));
}

/**
 * 화면에 보이는 행 id를 위에서 아래 순서로 모은다(펼친 폴더의 자식, 펼친 원본 PDF 아래 변환본 포함).
 * Shift+클릭 범위 선택의 기준이다.
 */
export function visibleTreeRowIds(
  items: readonly TreeItem[],
  openIds: ReadonlySet<string>,
  groups: TreeConversionGroups,
  collapsedSourceIds: ReadonlySet<string>
): string[] {
  const result: string[] = [];
  const visit = (entries: readonly TreeItem[]) => {
    for (const item of ungroupedTreeRows(entries, groups)) {
      result.push(item.id);
      const converted = groups.childrenBySourceId.get(item.id);
      if (converted && !collapsedSourceIds.has(item.id)) result.push(...converted.map((child) => child.item.id));
      if (item.children && openIds.has(item.id)) visit(item.children);
    }
  };
  visit(items);
  return result;
}

/**
 * 변환본을 거느린 원본 PDF 행의 배지. 접으면 「변환본 N」으로 개수만 보인다.
 * 아직 변환 중이라 기존 배지가 없으면 링크 없는 「원본 PDF」 배지를 만든다.
 */
export function groupedSourceBadge(
  badge: TreeConversionBadge | null,
  childCount: number,
  isCollapsed: boolean
): TreeConversionBadge {
  const base: TreeConversionBadge = badge ?? { label: "source", isConverted: false, description: { kind: "sourceConverting" }, relatedDocumentId: null };
  return isCollapsed ? { ...base, label: "converted", collapsedCount: childCount } : base;
}

/** 원본 PDF 아래 변환본 행의 배지. 변환 중이면 링크 없는 「변환 중」으로 바꾼다. */
export function groupedChildBadge(badge: TreeConversionBadge | null, isConverting: boolean): TreeConversionBadge | null {
  if (!isConverting) return badge;
  return { label: "converting", isConverted: false, description: { kind: "converting" }, relatedDocumentId: null };
}

/** 접은 원본 PDF 행 id를 워크스페이스별로 브라우저에 저장하는 localStorage 키 */
export function conversionCollapseStorageKey(workspaceId: string) {
  return `fruition.tree-conversion-collapsed.${workspaceId}`;
}
