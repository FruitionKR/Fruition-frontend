import type { MouseEvent as ReactMouseEvent } from "react";
import type { DropTarget, EditingState, FileDropTarget } from "@/entities/tree";

/** 트리에서 선택 가능한 항목(그래프 노드/문서 연결 정보 포함) */
export type SelectableTreeItem = {
  id: string;
  label: string;
  documentId?: string;
  graphNodeId?: string;
};

export type TreeInteractionProps = {
  draggedItemId: string | null;
  selectedItemId: string | null;
  /** Cmd/Ctrl+클릭으로 고른 이동 대상 항목 id */
  selectedItemIds: ReadonlySet<string>;
  dropTarget: DropTarget | null;
  fileDropTarget: FileDropTarget | null;
  editing: EditingState | null;
  /** 펼친 폴더 id. 뷰 전환으로 트리가 다시 마운트돼도 유지되도록 HomeWorkspace가 소유한다 */
  openIds: ReadonlySet<string>;
  onToggleOpen: (id: string) => void;
  onOpenMany: (ids: readonly string[]) => void;
  onMoveItem: (target: DropTarget) => void;
  onDropFiles: (projectId: string, folderId: string | null, files: File[]) => void;
  onDragStart: (projectId: string, itemId: string) => void;
  onToggleSelectItem: (itemId: string) => void;
  onClearSelectedItems: () => void;
  onDragOverItem: (target: DropTarget) => void;
  onFileDragOver: (target: FileDropTarget) => void;
  onFileDragLeave: () => void;
  onDragEnd: () => void;
  onContextMenuItem: (event: ReactMouseEvent<HTMLButtonElement>, projectId: string, itemId: string) => void;
  /** 폴더 행·트리 상단 + 버튼으로 버튼 아래에 생성 메뉴를 연다(itemId가 null이면 최상위, 같은 대상이면 닫는다) */
  onOpenFolderMenuAt: (projectId: string, itemId: string | null, anchor: HTMLElement) => void;
  onSelectGraphNode: (item: SelectableTreeItem) => void;
  onEditingChange: (label: string) => void;
  onCommitEditing: () => void;
  onCancelEditing: () => void;
};
