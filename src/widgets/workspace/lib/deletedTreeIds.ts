import { findTreeItem } from "@/entities/tree/lib/queries";
import type { Project, TreeItem } from "@/entities/tree/model/tree";

/** 삭제로 함께 사라지는 트리 항목·문서 id. 폴더를 지우면 하위 항목이 모두 포함된다. */
export type DeletedTreeIds = {
  documentIds: string[];
  treeItemIds: string[];
};

function collectIds(items: TreeItem[], result: DeletedTreeIds) {
  for (const item of items) {
    result.treeItemIds.push(item.id);
    if (item.documentId) result.documentIds.push(item.documentId);
    if (item.children) collectIds(item.children, result);
  }
}

/**
 * 삭제 직전 트리에서 대상과 그 하위의 id를 모은다.
 * itemId가 null이면 프로젝트(최상위 폴더) 전체가 대상이다. 대상이 트리에 없으면 빈 결과를 돌려준다.
 */
export function collectDeletedTreeIds(projects: Project[], projectId: string, itemId: string | null): DeletedTreeIds {
  const result: DeletedTreeIds = { documentIds: [], treeItemIds: [] };
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) return result;
  if (itemId === null) {
    collectIds(project.items, result);
    return result;
  }
  const item = findTreeItem(project.items, itemId);
  if (item) collectIds([item], result);
  return result;
}
