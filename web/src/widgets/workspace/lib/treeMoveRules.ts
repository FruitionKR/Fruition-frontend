import { isFileItem } from "@/entities/tree/lib/treeGuards";
import { findItemLocation, folderItems, normalizeTreeName, serverFolderId } from "@/entities/tree/lib/treeNames";
import { findTreeItem } from "@/entities/tree/lib/treeQueries";
import { canWriteTreeFolder, FOLDER_WRITE_FORBIDDEN_MESSAGE } from "@/entities/tree/lib/treePermission";
import type { FolderLocation } from "@/entities/tree/lib/treeNames";
import type { DropTarget, Project, TreeItem } from "@/entities/tree/model/tree";
import { selectedRootItems, type SkippedTreeItem } from "./treeBulkSelection";

type DraggedTreeItem = { projectId: string; itemId: string };

/** 드래그 앤 드롭 결과를 분류한 순수 규칙 결과. 실제 부수효과(모달·서버 호출)는 호출자가 수행한다. */
type TreeMoveResolution =
  | { kind: "invalid" }
  | { kind: "conflict" }
  /** 폴더를 자기 자신이나 하위 폴더 안으로 옮기려는 경우 */
  | { kind: "cycle" }
  /** 목적지나 출발 폴더에 넣거나 꺼낼 권한이 없는 경우. 권한을 모르면 여기로 오지 않고 서버가 판단한다. */
  | { kind: "forbidden" }
  | { kind: "merge"; sourceItem: TreeItem; targetItem: TreeItem; destination: FolderLocation; folderId: string | null }
  | { kind: "move"; item: TreeItem; destination: FolderLocation; folderId: string | null; position: number | undefined }
  /** 묶음 이동: items는 트리 순서로 옮길 항목, skipped는 옮길 수 없어 건너뛴 항목과 이유 */
  | { kind: "move-many"; items: TreeItem[]; skipped: SkippedTreeItem[]; destination: FolderLocation; folderId: string | null };

function isFolderDenied(projects: Project[], location: FolderLocation, isWorkspaceOwner: boolean | null): boolean {
  const project = projects.find((entry) => entry.id === location.projectId);
  return canWriteTreeFolder(project?.items ?? [], location.folderId, isWorkspaceOwner) === false;
}

/** 지금 있는 폴더에서 이 항목을 꺼낼 권한이 없으면 true. 단일 항목을 끌기 시작할 때도 쓴다. */
export function isMoveOutDenied(projects: Project[], itemId: string, isWorkspaceOwner: boolean | null): boolean {
  const location = findItemLocation(projects, itemId);
  return Boolean(location) && isFolderDenied(projects, location as FolderLocation, isWorkspaceOwner);
}

/** 대상에 놓았을 때 항목이 들어갈 위치. 폴더 안이면 그 폴더, 문서 위면 그 문서의 폴더, targetId가 null이면 최상위다. */
function dropDestination(projects: Project[], target: DropTarget, targetItem: TreeItem | null): FolderLocation | undefined {
  if (target.position === "inside" && targetItem && !isFileItem(targetItem)) return { projectId: target.projectId, folderId: targetItem.id };
  return targetItem ? findItemLocation(projects, targetItem.id) : { projectId: target.projectId, folderId: null };
}

/** 끌고 있는 항목을 이 대상에 놓으면 권한 없는 폴더에 넣게 되는지. 드래그 중 표시에 쓴다. */
export function isDropDeniedByFolder(projects: Project[], target: DropTarget, isWorkspaceOwner: boolean | null): boolean {
  const project = projects.find((entry) => entry.id === target.projectId);
  const targetItem = project && target.targetId ? findTreeItem(project.items, target.targetId) : null;
  const destination = dropDestination(projects, target, targetItem);
  return Boolean(destination) && isFolderDenied(projects, destination as FolderLocation, isWorkspaceOwner);
}

/**
 * 끌어다 놓은 항목과 대상으로부터 이동·묶음·충돌 여부를 계산한다.
 * @param isWorkspaceOwner 폴더 권한 판단에 쓴다. 역할을 아직 모르면 null이고 막지 않는다.
 */
export function resolveTreeMove(
  projects: Project[],
  dragged: DraggedTreeItem | null,
  target: DropTarget,
  selectedItemIds: ReadonlySet<string>,
  isWorkspaceOwner: boolean | null = null
): TreeMoveResolution {
  if (!dragged) return { kind: "invalid" };
  const source = projects.find((project) => project.id === dragged.projectId);
  const item = source && findTreeItem(source.items, dragged.itemId);
  const targetProject = projects.find((project) => project.id === target.projectId);
  const targetItem = targetProject && target.targetId ? findTreeItem(targetProject.items, target.targetId) : null;
  if (!item || !targetProject || item.id === targetItem?.id) return { kind: "invalid" };
  if (isFileItem(item) && !item.documentId) return { kind: "invalid" };
  const destination = dropDestination(projects, target, targetItem);
  if (!destination) return { kind: "invalid" };
  if (isFolderDenied(projects, destination, isWorkspaceOwner)) return { kind: "forbidden" };
  // 선택 묶음 중 하나를 끌었으면 묶음 전체를 옮긴다. 묶음 이동은 문서 위 드롭도 그 문서의 부모 폴더로 넣는다.
  if (selectedItemIds.has(item.id) && selectedItemIds.size > 1) {
    return resolveManyMove(projects, [...selectedItemIds], destination, targetItem?.id ?? null, isWorkspaceOwner);
  }
  if (isMoveOutDenied(projects, item.id, isWorkspaceOwner)) return { kind: "forbidden" };
  if (movesIntoOwnSubtree(item, destination)) return { kind: "cycle" };
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
  targetId: string | null,
  isWorkspaceOwner: boolean | null
): TreeMoveResolution {
  // 선택한 폴더의 하위 항목은 폴더와 함께 옮겨지므로 빼고, 상대 순서를 지키도록 트리 순서로 옮긴다.
  const candidates = selectedRootItems(projects, new Set(itemIds))
    .filter((entry) => entry.id !== targetId && entry.id !== destination.folderId);
  const destinationItems = folderItems(projects, destination);
  const destinationIds = new Set(destinationItems.map((entry) => entry.id));
  const takenNames = new Set(destinationItems.map((entry) => normalizeTreeName(entry.label)));
  const items: TreeItem[] = [];
  const skipped: SkippedTreeItem[] = [];
  for (const entry of candidates) {
    // 이미 대상 폴더에 있는 항목은 옮길 필요가 없다.
    if (destinationIds.has(entry.id)) continue;
    const reason = isMoveOutDenied(projects, entry.id, isWorkspaceOwner)
      ? FOLDER_WRITE_FORBIDDEN_MESSAGE
      : manyMoveSkipReason(entry, destination, takenNames);
    if (reason) {
      skipped.push({ label: entry.label, reason });
      continue;
    }
    takenNames.add(normalizeTreeName(entry.label));
    items.push(entry);
  }
  if (items.length === 0 && skipped.length === 0) return { kind: "invalid" };
  return { kind: "move-many", items, skipped, destination, folderId: serverFolderId(projects, destination) };
}

/** 묶음 이동에서 이 항목을 건너뛸 이유. 옮길 수 있으면 null. */
function manyMoveSkipReason(item: TreeItem, destination: FolderLocation, takenNames: ReadonlySet<string>): string | null {
  if (item.generated) return "자동 생성 항목은 옮길 수 없습니다";
  if (item.status === "uploading" || (isFileItem(item) && !item.documentId)) return "업로드가 끝나지 않았습니다";
  if (item.canEdit === false) return "편집 권한이 없습니다";
  if (movesIntoOwnSubtree(item, destination)) return "자기 자신이나 하위 폴더 안으로 옮길 수 없습니다";
  if (takenNames.has(normalizeTreeName(item.label))) return "대상 폴더에 같은 이름의 항목이 있습니다";
  return null;
}

/** 폴더를 자기 자신이나 자기 하위 폴더로 옮기면 순환이 생긴다. 서버도 거절하지만 왕복 없이 먼저 막는다. */
function movesIntoOwnSubtree(item: TreeItem, destination: FolderLocation): boolean {
  if (isFileItem(item) || !destination.folderId) return false;
  return destination.folderId === item.id || Boolean(findTreeItem(item.children ?? [], destination.folderId));
}
