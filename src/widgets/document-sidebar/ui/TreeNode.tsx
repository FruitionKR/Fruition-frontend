import { cx } from "@/shared/lib/classNames";
import { isFileItem } from "@/entities/tree";
import type { DropTarget, TreeItem } from "@/entities/tree";
import { InlineEditInput } from "./InlineEditInput";
import { TreeNodeIcon } from "./TreeNodeIcon";
import type { TreeInteractionProps } from "../model/types";
import { useTreeNodeDragDrop } from "../lib/useTreeNodeDragDrop";
import styles from "./DocumentSidebar.module.css";

// 트리 행 들여쓰기: 기본 패딩 + depth당 증가 폭 (px)
const TREE_ROW_BASE_PADDING_PX = 8;
const TREE_ROW_INDENT_PER_DEPTH_PX = 18;

// mime type → 시안의 우측 파일 타입 배지 문구
const MIME_TYPE_BADGES: [pattern: string, label: string][] = [
  ["pdf", "PDF"],
  ["plain", "TXT"]
];

/** 실제 파일명은 유지하고 표시할 이름과 우측 확장자를 분리한다. */
export function fileDisplay(item: TreeItem) {
  if (!isFileItem(item)) return { name: item.label, badge: null };

  const dotIndex = item.label.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < item.label.length - 1) {
    return {
      name: item.label.slice(0, dotIndex),
      badge: item.label.slice(dotIndex + 1).toUpperCase()
    };
  }

  const mimeType = item.mimeType ?? "";
  const matched = MIME_TYPE_BADGES.find(([pattern]) => mimeType.includes(pattern));
  return { name: item.label, badge: matched?.[1] ?? null };
}

export function TreeNode({
  item,
  depth,
  openIds,
  onToggle,
  projectId,
  onDropItem,
  interaction
}: {
  item: TreeItem;
  depth: number;
  openIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  projectId: string;
  onDropItem: (target: DropTarget) => void;
  /** 트리 상호작용 상태·핸들러 묶음. onMoveItem은 onDropItem으로 감싸서 받는다 */
  interaction: Omit<TreeInteractionProps, "onMoveItem">;
}) {
  const { draggedItemId, dropTarget, fileDropTarget, editing, selectedItemIds } = interaction;
  const isSelected = selectedItemIds.has(item.id);
  // 선택된 묶음 중 하나를 끌면 나머지 선택 항목도 함께 이동하므로 같이 흐리게 표시한다.
  const isDraggingGroup = draggedItemId !== null && isSelected && selectedItemIds.has(draggedItemId);
  const isOpen = openIds.has(item.id);
  const isDropTarget = dropTarget?.projectId === projectId && dropTarget.targetId === item.id;
  const isFileDropTarget = fileDropTarget?.projectId === projectId && fileDropTarget.folderId === item.id;
  const isEditing = editing?.projectId === projectId && editing.itemId === item.id;
  // 폴더 안으로 넣는 드롭은 폴더 행만이 아니라 펼쳐진 자식까지 한 블록으로 강조한다.
  // 빈 폴더도 펼침 화살표·토글을 가져 노트와 구분되게 한다.
  const isFolder = item.type === "folder";
  const isDropInside = isDropTarget && dropTarget.position === "inside";
  const isFolderBlockTarget = isFolder && (isDropInside || isFileDropTarget);
  // 업로드가 끝나기 전 자리표시 행: 열기·드래그·메뉴를 막고 진행 중임을 표시한다.
  const isUploading = item.status === "uploading";
  const display = fileDisplay(item);
  const {
    canDrag,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop
  } = useTreeNodeDragDrop({
    item,
    projectId,
    onDragStart: interaction.onDragStart,
    onDragOverItem: interaction.onDragOverItem,
    onFileDragOver: interaction.onFileDragOver,
    onFileDragLeave: interaction.onFileDragLeave,
    onDropItem,
    onDropFiles: interaction.onDropFiles
  });

  return (
    <div className={cx(styles["tree-group"], isFolderBlockTarget && styles["is-drop-inside"])}>
      <button
        type="button"
        className={cx(
          styles["tree-row"],
          item.active && styles["is-active"],
          isUploading && styles["is-uploading"],
          isSelected && styles["is-selected"],
          (draggedItemId === item.id || isDraggingGroup) && styles["is-dragging"],
          isFileDropTarget && styles["is-file-drop-target"],
          item.type === "folder" ? styles["is-folder"] : styles["is-note"],
          depth > 0 && styles["is-nested"],
          isDropTarget && styles[`is-drop-${dropTarget.position}`]
        )}
        style={{ paddingLeft: TREE_ROW_BASE_PADDING_PX + depth * TREE_ROW_INDENT_PER_DEPTH_PX }}
        title={item.errorMessage ?? item.sourceUri}
        aria-expanded={isFolder ? isOpen : undefined}
        aria-busy={isUploading || undefined}
        aria-disabled={isUploading || undefined}
        draggable={!isEditing && !isUploading && canDrag}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={interaction.onDragEnd}
        onContextMenu={(event) => {
          if (isUploading) return event.preventDefault();
          interaction.onContextMenuItem(event, projectId, item.id);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (isUploading || isEditing) return;
          // Cmd/Ctrl+클릭: 열지 않고 이동 대상으로 고른다. 위키 노드는 이동 대상이 아니다.
          if ((event.metaKey || event.ctrlKey) && item.type !== "wiki") {
            interaction.onToggleSelectItem(item.id);
            return;
          }
          if (selectedItemIds.size > 0) interaction.onClearSelectedItems();
          if (!isEditing && (item.graphNodeId || item.documentId)) interaction.onSelectGraphNode(item);
          if (!isEditing && isFolder) onToggle(item.id);
        }}
      >
        <TreeNodeIcon item={item} isExpandable={isFolder} isOpen={isOpen} />
        {isEditing ? (
          <InlineEditInput
            value={editing.label}
            onChange={interaction.onEditingChange}
            onCommit={interaction.onCommitEditing}
            onCancel={interaction.onCancelEditing}
          />
        ) : (
          <>
            <span>{display.name}</span>
            {isUploading
              ? <small className={styles["tree-type-badge"]}>업로드 중</small>
              : display.badge && <small className={styles["tree-type-badge"]}>{display.badge}</small>}
            {isFileDropTarget && <small className={styles["tree-drop-hint"]}>여기에 추가</small>}
          </>
        )}
      </button>
      {isFolder && isOpen && item.children?.map((child) => (
        <TreeNode
          key={child.id}
          item={child}
          depth={depth + 1}
          openIds={openIds}
          onToggle={onToggle}
          projectId={projectId}
          onDropItem={onDropItem}
          interaction={interaction}
        />
      ))}
    </div>
  );
}
