import type { DragEvent as ReactDragEvent } from "react";
import type { DropTarget, FileDropTarget, TreeItem } from "@/entities/tree";
import { canDragTreeItem, getDroppedFiles, hasDroppedFiles, isFileItem } from "@/entities/tree";
import { isPointerLeavingElement, setLightDragPreview } from "../lib/dragDropHelpers";

export function useTreeNodeDragDrop({
  item,
  projectId,
  onDragStart,
  onDragOverItem,
  onFileDragOver,
  onFileDragLeave,
  onDropItem,
  onDropFiles
}: {
  item: TreeItem;
  projectId: string;
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
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setLightDragPreview(event);
    onDragStart(projectId, item.id);
  }

  function handleDragOver(event: ReactDragEvent<HTMLButtonElement>) {
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
