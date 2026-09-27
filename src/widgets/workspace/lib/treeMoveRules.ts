import { isFileItem, isWikiItem } from "@/entities/tree/lib/guards";
import { findItemLocation, folderItems, normalizeTreeName, serverFolderId } from "@/entities/tree/lib/names";
import { findTreeItem } from "@/entities/tree/lib/queries";
import type { FolderLocation } from "@/entities/tree/lib/names";
import type { DropTarget, Project, TreeItem } from "@/entities/tree/model/tree";

export type DraggedTreeItem = { projectId: string; itemId: string };

/** 드래그 앤 드롭 결과를 분류한 순수 규칙 결과. 실제 부수효과(모달·서버 호출)는 호출자가 수행한다. */
export type TreeMoveResolution =
  | { kind: "invalid" }
  | { kind: "conflict" }
  | { kind: "merge"; sourceItem: TreeItem; targetItem: TreeItem; destination: FolderLocation; folderId: string | null }
  | { kind: "move"; item: TreeItem; destination: FolderLocation; folderId: string | null; position: number | undefined }
  | { kind: "move-many"; items: TreeItem[]; destination: FolderLocation; folderId: string | null };

/** 끌어다 놓은 항목과 대상으로부터 이동·묶음·충돌 여부를 계산한다. */
export function resolveTreeMove(
  projects: Project[],
  dragged: DraggedTreeItem | null,
  target: DropTarget,
  selectedItemIds: ReadonlySet<string>
): TreeMoveResolution {
  if (!dragged) return { kind: "invalid" };
  const source = projects.find((project) => project.id === dragged.projectId);
  const item = source && findTreeItem(source.items, dragged.itemId);
  const targetProject = projects.find((project) => project.id === target.projectId);
  const targetItem = targetProject && target.targetId ? findTreeItem(targetProject.items, target.targetId) : null;
  if (!item || !targetProject || isWikiItem(item) || item.id === targetItem?.id) return { kind: "invalid" };
  if (isFileItem(item) && !item.documentId) return { kind: "invalid" };
  const parent = targetItem ? findItemLocation(projects, targetItem.id) : { projectId: target.projectId, folderId: null };
  if (!parent) return { kind: "invalid" };
  const destination = target.position === "inside" && targetItem && !isFileItem(targetItem)
    ? { projectId: target.projectId, folderId: targetItem.id } : parent;
  // 선택 묶음 중 하나를 끌었으면 묶음 전체를 옮긴다. 묶음 이동은 문서 위 드롭도 그 문서의 부모 폴더로 넣는다.
  if (selectedItemIds.has(item.id) && selectedItemIds.size > 1) {
    return resolveManyMove(projects, [...selectedItemIds], destination, targetItem?.id ?? null);
  }
  const siblings = folderItems(projects, destination).filter((sibling) => sibling.id !== item.id);
  const isMerge = target.position === "inside" && targetItem && isFileItem(item) && isFileItem(targetItem);
  const conflicting = isMerge
    ? normalizeTreeName(item.label) === normalizeTreeName(targetItem.label)
    : siblings.some((sibling) => normalizeTreeName(sibling.label) === normalizeTreeName(item.label));
  if (conflicting) return { kind: "conflict" };
  const folderId = serverFolderId(projects, destination);
  if (isMerge && targetItem.documentId && item.documentId) {
    return { kind: "merge", sourceItem: item, targetItem, destination, folderId };
  }
  const index = targetItem ? siblings.findIndex((sibling) => sibling.id === targetItem.id) : -1;
  const position = target.position === "inside" || index < 0 ? undefined : index + (target.position === "after" ? 1 : 0);
  return { kind: "move", item, destination, folderId, position };
}

function resolveManyMove(
  projects: Project[],
  itemIds: string[],
  destination: FolderLocation,
  targetId: string | null
): TreeMoveResolution {
  const project = projects.find((entry) => entry.id === destination.projectId);
  const items = itemIds
    .map((itemId) => project && findTreeItem(project.items, itemId))
    .filter((entry): entry is TreeItem => Boolean(entry) && !isWikiItem(entry!) && (!isFileItem(entry!) || Boolean(entry!.documentId)))
    .filter((entry) => entry.id !== targetId && entry.id !== destination.folderId);
  if (items.length === 0) return { kind: "invalid" };
  const movingIds = new Set(items.map((entry) => entry.id));
  const siblingNames = new Set(folderItems(projects, destination)
    .filter((sibling) => !movingIds.has(sibling.id))
    .map((sibling) => normalizeTreeName(sibling.label)));
  const movingNames = items.map((entry) => normalizeTreeName(entry.label));
  if (movingNames.some((name) => siblingNames.has(name)) || new Set(movingNames).size !== movingNames.length) {
    return { kind: "conflict" };
  }
  return { kind: "move-many", items, destination, folderId: serverFolderId(projects, destination) };
}
