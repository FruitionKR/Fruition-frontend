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
  /** Cmd/Ctrl+클릭·Shift+클릭으로 고른 묶음 이동·삭제 대상 항목 id */
  selectedItemIds: ReadonlySet<string>;
  /** 스킬 실행 대상 고르기 중: 행을 눌러도 열지 않고 onToggleSelectItem으로 고른다 */
  isPickingTarget?: boolean;
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
  /** Shift+클릭: 마지막으로 누른 행부터 이 행까지 보이는 행을 고른다 */
  onSelectItemRange: (itemId: string) => void;
  /** 선택 해제. anchorItemId를 주면 다음 Shift+클릭의 시작 행으로 삼는다 */
  onClearSelectedItems: (anchorItemId?: string) => void;
  /** 선택한 항목 묶음 삭제(Delete·Backspace 키). 확인 모달을 거친다 */
  onDeleteSelectedItems: () => void;
  onDragOverItem: (target: DropTarget) => void;
  onFileDragOver: (target: FileDropTarget) => void;
  onFileDragLeave: () => void;
  onDragEnd: () => void;
  onContextMenuItem: (event: ReactMouseEvent<HTMLButtonElement>, projectId: string, itemId: string) => void;
  /** 폴더 행·트리 상단 + 버튼으로 버튼 아래에 생성 메뉴를 연다(itemId가 null이면 최상위, 같은 대상이면 닫는다) */
  onOpenFolderMenuAt: (projectId: string, itemId: string | null, anchor: HTMLElement) => void;
  onSelectGraphNode: (item: SelectableTreeItem) => void;
  /** 문서 행 가운데 클릭: 그 문서를 새 브라우저 탭으로 연다 */
  onOpenInNewTab: (item: SelectableTreeItem) => void;
  onEditingChange: (label: string) => void;
  onCommitEditing: () => void;
  onCancelEditing: () => void;
};
