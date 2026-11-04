import type { DragEvent as ReactDragEvent } from "react";
import type { DropTarget, FileDropTarget, TreeItem } from "@/entities/tree";
import { canDragTreeItem, getDroppedFiles, hasDroppedFiles, isFileItem } from "@/entities/tree";
import { isPointerLeavingElement, setLightDragPreview } from "../lib/dragDropHelpers";

export function useTreeNodeDragDrop({
  item,
  projectId,
  canStartDrag,
  isDropDenied,
  isFolderWriteDenied,
  onDragDenied,
  onDragStart,
  onDragOverItem,
  onFileDragOver,
  onFileDragLeave,
  onDropItem,
  onDropFiles
}: {
  item: TreeItem;
  projectId: string;
  /** 지금 폴더에서 꺼낼 수 없으면 false이고, 이유는 호출한 쪽이 알린다. */
  canStartDrag: (itemId: string) => boolean;
  /** 끌고 있는 항목을 이 대상에 놓으면 권한 없는 폴더에 넣게 되는지 */
  isDropDenied: (target: DropTarget) => boolean;
  isFolderWriteDenied: (folderId: string) => boolean;
  /** 권한이 없어 놓을 수 없는 행 위에 올라왔을 때 그 행 id, 벗어나면 null */
  onDragDenied: (itemId: string | null) => void;
  onDragStart: (projectId: string, itemId: string) => void;
  onDragOverItem: (target: DropTarget) => void;
  onFileDragOver: (target: FileDropTarget) => void;
  onFileDragLeave: () => void;
  onDropItem: (target: DropTarget) => void;
  onDropFiles: (projectId: string, folderId: string | null, files: File[]) => void;
}) {
  const canDrag = canDragTreeItem(item);
  const canNestChildren = !isFileItem(item);

  function handleDragStart(event: ReactDragEvent<HTMLButtonElement>) {
    if (!canDrag) return;
    if (!canStartDrag(item.id)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setLightDragPreview(event);
    onDragStart(projectId, item.id);
  }

  function isDragOverDenied(event: ReactDragEvent<HTMLButtonElement>) {
    if (hasDroppedFiles(event)) return !isFileItem(item) && isFolderWriteDenied(item.id);
    return !item.generated && isDropDenied({ projectId, targetId: item.id, position: "inside" });
  }

  function handleDragOver(event: ReactDragEvent<HTMLButtonElement>) {
    // preventDefault를 하지 않으면 브라우저가 놓을 수 없는 대상으로 다룬다. 상위(최상위 드롭 영역)로 올라가지 않게만 막는다.
    if (isDragOverDenied(event)) {
      event.stopPropagation();
      event.dataTransfer.dropEffect = "none";
      onDragDenied(item.id);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = hasDroppedFiles(event) ? "copy" : "move";
    if (hasDroppedFiles(event) && !isFileItem(item)) {
      event.stopPropagation();
      onFileDragOver({ projectId, folderId: item.id });
      return;
    }
    if (item.generated) return;
    // 문서 트리는 항상 이름순 정렬이라 앞/뒤 순서 이동이 없다. 폴더 안으로 넣기(또는 문서끼리 묶기)만 허용한다.
    onDragOverItem({ projectId, targetId: item.id, position: "inside" });
  }

  function handleDragLeave(event: ReactDragEvent<HTMLButtonElement>) {
    if (isPointerLeavingElement(event)) onDragDenied(null);
    if (!hasDroppedFiles(event)) return;
    event.stopPropagation();
    if (!isPointerLeavingElement(event)) return;
    onFileDragLeave();
  }

  function handleDrop(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (hasDroppedFiles(event)) {
      event.stopPropagation();
      onFileDragLeave();
      onDropFiles(projectId, canNestChildren ? item.id : null, getDroppedFiles(event));
      return;
    }
    if (!item.generated) {
      onDropItem({ projectId, targetId: item.id, position: "inside" });
    }
  }

  return {
    canDrag,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
