import { useMemo, useState } from "react";
import { findSourceNodeByDocumentId, makeRawId, rawNodeIdToDocumentId } from "@/entities/graph/lib/graph";
import { findTreeItem, findTreeItemByGraphNodeId } from "@/entities/tree";
import type { SourceBlockHighlight } from "@/entities/document";
import type { Project } from "@/entities/tree";
import type { GraphNode } from "@/entities/wiki";
import { toDocumentLocation, type WorkspaceLocation } from "../lib/workspaceLocation";
import { focusGraphNode } from "./focusGraphNode";

export type PreviewTarget = {
  pageId: string | null;
  title: string;
  pageType: string | null;
  sourceBlockHighlights?: SourceBlockHighlight[];
};

// 트리/그래프 선택 관련 상태는 항상 함께 변경되므로 하나의 객체로 관리한다.
export type TreeSelectionState = {
  focusedGraphNodeId: string | null;
  selectedTreeItemId: string | null;
  selectedPreviewTarget: PreviewTarget | null;
  selectedDocumentId: string | null;
};

const EMPTY_SELECTION: TreeSelectionState = {
  focusedGraphNodeId: null,
  selectedTreeItemId: null,
  selectedPreviewTarget: null,
  selectedDocumentId: null
};

/** 지금 미리보기 중인 대상의 URL 위치. 미리보기 대상이 없으면 null. */
export function getSelectionLocation(selection: TreeSelectionState): WorkspaceLocation | null {
  if (!selection.selectedPreviewTarget) return null;
  return toDocumentLocation({
    pageId: selection.selectedPreviewTarget.pageId,
    documentId: selection.selectedDocumentId,
    treeItemId: selection.selectedTreeItemId
  });
}

export function useTreeSelection(projects: Project[], nodes: GraphNode[]) {
  const [selection, setSelection] = useState<TreeSelectionState>(EMPTY_SELECTION);
  const { focusedGraphNodeId, selectedTreeItemId, selectedPreviewTarget, selectedDocumentId } = selection;
  const selectionLocation = getSelectionLocation(selection);
  const selectedDocumentTitle = useMemo(() => {
    if (selectedTreeItemId) {
      for (const project of projects) {
        const item = findTreeItem(project.items, selectedTreeItemId);
        if (item) return item.label;
      }
    }
    return selectedPreviewTarget?.title ?? null;
  }, [projects, selectedPreviewTarget, selectedTreeItemId]);

  function findTreeItemIdByGraphNodeId(nodeId: string) {
    for (const project of projects) {
      const found = findTreeItemByGraphNodeId(project.items, nodeId);
      if (found) return found.id;
    }
    return null;
  }

  function openPreviewTarget({
    nodeId,
    title,
    pageType = null,
    treeItemId,
    documentId = null
  }: {
    nodeId: string;
    title: string;
    pageType?: string | null;
    treeItemId?: string | null;
    documentId?: string | null;
  }): TreeSelectionState {
    // wiki page(source/concept)면 pageId로 상세 조회, 아니면 raw 문서로 처리한다.
    const isWikiPage = pageType === "source" || pageType === "concept";
    const rawDocumentId = rawNodeIdToDocumentId(nodeId) ?? documentId;
    const resolvedTreeItemId = treeItemId ?? findTreeItemIdByGraphNodeId(nodeId);

    const next: TreeSelectionState = {
      selectedTreeItemId: resolvedTreeItemId,
      selectedPreviewTarget: { pageId: isWikiPage ? nodeId : null, title, pageType: isWikiPage ? pageType : null },
      focusedGraphNodeId: nodeId,
      selectedDocumentId: isWikiPage ? null : rawDocumentId
    };
    setSelection(next);
    return next;
  }

  // 각 열기 함수는 바뀐 선택 상태를 돌려줘 호출부가 같은 대상의 URL로 이동할 수 있게 한다.
  function selectTreeGraphNode(item: { id: string; label: string; documentId?: string; graphNodeId?: string }) {
    const nodeId = item.graphNodeId ?? (item.documentId ? makeRawId(item.documentId) : null);
    if (!nodeId) return null;
    return openPreviewTarget({
      nodeId,
      title: item.label,
      treeItemId: item.id,
      documentId: item.documentId ?? null
    });
  }

  function openGraphNodePreview(node: GraphNode) {
    setSelection((current) => focusGraphNode(current, node.id));
  }

  function openWikiPagePreview(pageId: string, title: string, pageType: string) {
    return openPreviewTarget({ nodeId: pageId, title, pageType, treeItemId: findTreeItemIdByGraphNodeId(pageId) });
  }

  function openSourceBlockPreview(documentId: string, title: string, sourceBlockHighlights: SourceBlockHighlight[]) {
    const rawNodeId = makeRawId(documentId);
    const sourceNodeId = findSourceNodeByDocumentId(nodes, documentId)?.id ?? null;
    const next: TreeSelectionState = {
      selectedTreeItemId: findTreeItemIdByGraphNodeId(rawNodeId) ?? (sourceNodeId ? findTreeItemIdByGraphNodeId(sourceNodeId) : null),
      selectedPreviewTarget: { pageId: null, title, pageType: null, sourceBlockHighlights },
      focusedGraphNodeId: sourceNodeId ?? rawNodeId,
      selectedDocumentId: documentId
    };
    setSelection(next);
    return next;
  }

  function clearTreeGraphSelection() {
    setSelection(EMPTY_SELECTION);
  }

  // 그래프 빈 영역 클릭용. 문서·미리보기 선택은 유지하고 그래프 포커스만 지운다.
  function clearGraphFocus() {
    setSelection((current) =>
      current.focusedGraphNodeId === null ? current : { ...current, focusedGraphNodeId: null }
    );
  }

  return {
    focusedGraphNodeId,
    selectedTreeItemId,
    selectedDocumentTitle,
    selectedPreviewTarget,
    selectedDocumentId,
    selectionLocation,
    selectTreeGraphNode,
    openGraphNodePreview,
    openWikiPagePreview,
    openSourceBlockPreview,
    clearTreeGraphSelection,
    clearGraphFocus
  };
}
