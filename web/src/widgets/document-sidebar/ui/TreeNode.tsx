import { cx } from "@/shared/lib/classNames";
import Link from "next/link";
import { effectivePermission, isFileItem, permissionForChildren } from "@/entities/tree";
import { plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { DropTarget, InheritedPermission, TreeItem } from "@/entities/tree";
import { InlineEditInput } from "./InlineEditInput";
import { inheritedPermissionLabel, permissionIndicatorLabel } from "@/entities/document/lib/documentAccess";
import { SidebarConversionLinkIcon, SidebarPermissionIcon } from "./SidebarIcons";
import { buildWorkspaceHref } from "@/widgets/workspace/lib/workspaceLocation";
import { TreeNodeIcon } from "./TreeNodeIcon";
import type { TreeInteractionProps } from "../model/treeInteraction";
import { useTreeNodeDragDrop } from "../model/useTreeNodeDragDrop";
import styles from "./DocumentSidebar.module.css";

// 트리 행 들여쓰기 (Figma 1486:4410): 기본 10px + depth당 22px (pl 10 / 32)
const TREE_ROW_BASE_PADDING_PX = 10;
const TREE_ROW_INDENT_PER_DEPTH_PX = 22;

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
  interaction,
  inheritedPermission = null
}: {
  item: TreeItem;
  depth: number;
  openIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  projectId: string;
  onDropItem: (target: DropTarget) => void;
  /** 트리 상호작용 상태·핸들러 묶음. onMoveItem은 onDropItem으로 감싸서 받는다 */
  interaction: Omit<TreeInteractionProps, "onMoveItem">;
  /** 가장 가까운 상위 폴더의 자기 권한. 상위 설정 따름 항목의 적용 권한 표시에 쓴다 */
  inheritedPermission?: InheritedPermission;
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
  // 지금 위키 편입을 시작할 수 있는 문서에만 신규·수정됨·재시도 배지를 붙인다(업로드 중 자리표시 행 제외).
  const wikiReflectBadge = !isUploading && item.documentId
    ? interaction.wikiReflectBadges?.get(item.documentId) ?? null
    : null;
  // 기존 확장자 배지 자리에서 원본 PDF와 변환된 노트의 역할·연결을 보여준다.
  const conversionBadge = !isUploading && item.documentId
    ? interaction.conversionBadges?.get(item.documentId) ?? null
    : null;
  const relatedDocumentId = !isEditing && !interaction.isPickingTarget ? conversionBadge?.relatedDocumentId : null;
  // 편집 가능은 기본 상태라 표시하지 않고, 직접 설정·상속 모두 보기 전용일 때만 표시한다.
  const permission = effectivePermission(item, inheritedPermission);
  const permissionLabel = permission?.access === "view" && (permission.source === "own"
    ? permissionIndicatorLabel(permission.access)
    : inheritedPermissionLabel(permission.access, permission.fromFolderName));
  const permissionDescription = "편집 권한이 없으면 읽기만 가능";
  // 폴더 hover·포커스 시 우측 + 버튼으로 우클릭과 같은 생성 메뉴를 연다. 편집·업로드·드래그 중에는 숨긴다.
  const canShowFolderAction = isFolder && !isEditing && !isUploading && draggedItemId === null;
  const canOpenInNewTab = !isEditing && !isUploading && Boolean(item.graphNodeId || item.documentId);
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
      <div className={styles["tree-row-wrap"]}>
      <button
        type="button"
        className={cx(
          styles["tree-row"],
          // 지금 열린 문서(URL 대상)의 행을 강조한다.
          (item.active || interaction.selectedItemId === item.id) && styles["is-active"],
          isUploading && styles["is-uploading"],
          isSelected && styles["is-selected"],
          (draggedItemId === item.id || isDraggingGroup) && styles["is-dragging"],
          isFileDropTarget && styles["is-file-drop-target"],
          item.type === "folder" ? styles["is-folder"] : styles["is-note"],
          canShowFolderAction && styles["has-folder-action"],
          isDropTarget && styles[`is-drop-${dropTarget.position}`]
        )}
        style={{ paddingLeft: TREE_ROW_BASE_PADDING_PX + depth * TREE_ROW_INDENT_PER_DEPTH_PX }}
        // 저장소 경로(sourceUri)는 내부 정보라 보이지 않는다. 처리 실패 사유만 알려 준다.
        title={item.errorMessage}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
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
        // 가운데 클릭: 문서를 새 브라우저 탭으로 연다. mousedown 기본 동작(자동 스크롤)은 막는다.
        // Shift+클릭은 범위 선택이라 글자 선택이 생기지 않게 막는다.
        onMouseDown={(event) => {
          if (event.button === 1 && canOpenInNewTab) event.preventDefault();
          if (event.button === 0 && event.shiftKey && !interaction.isPickingTarget) event.preventDefault();
        }}
        onAuxClick={(event) => {
          if (event.button !== 1 || !canOpenInNewTab) return;
          event.preventDefault();
          event.stopPropagation();
          interaction.onOpenInNewTab(item);
        }}
        onKeyDown={(event) => {
          // 입력 중인 이름 편집 칸의 키는 건드리지 않는다.
          if (event.target !== event.currentTarget || isEditing || interaction.isPickingTarget) return;
          // Delete·Backspace: 고른 항목을 묶음 삭제한다(확인 모달).
          if ((event.key === "Delete" || event.key === "Backspace") && selectedItemIds.size > 0) {
            event.preventDefault();
            interaction.onDeleteSelectedItems();
            return;
          }
          // 키보드로도 마우스와 같은 선택: Cmd/Ctrl+Space·Enter는 토글, Shift+Space·Enter는 범위 선택.
          if ((event.key !== " " && event.key !== "Enter") || isUploading || item.type === "wiki") return;
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            interaction.onToggleSelectItem(item.id);
          } else if (event.shiftKey) {
            event.preventDefault();
            interaction.onSelectItemRange(item.id);
          }
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (isUploading || isEditing) return;
          // 스킬 실행 대상 고르기: 문서·폴더 행을 고른다(폴더는 펼치기도 한다). 쓸 수 있는 대상인지는 고르는 쪽이 판단한다.
          if (interaction.isPickingTarget) {
            if (isFolder) onToggle(item.id);
            interaction.onToggleSelectItem(item.id);
            return;
          }
          // Cmd/Ctrl+클릭: 열지 않고 묶음 대상으로 고른다. 위키 노드는 이동·삭제 대상이 아니다.
          if ((event.metaKey || event.ctrlKey) && item.type !== "wiki") {
            interaction.onToggleSelectItem(item.id);
            return;
          }
          // Shift+클릭: 마지막으로 누른 행부터 이 행까지 보이는 행을 고른다.
          if (event.shiftKey && item.type !== "wiki") {
            interaction.onSelectItemRange(item.id);
            return;
          }
          // 일반 클릭: 묶음 선택을 풀고 지금처럼 연다. 이 행이 다음 Shift+클릭의 시작이 된다.
          interaction.onClearSelectedItems(item.id);
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
            <Tooltip content={permissionDescription} hint={item.label} placement="right">
              <span className={styles["tree-label-text"]}>{display.name}</span>
            </Tooltip>
            {permission && permissionLabel && (
              <Tooltip content={permissionDescription} placement="right" describe={false} className={styles["tree-permission-indicator"]}>
                <SidebarPermissionIcon
                  permission={permission.access}
                  label={permissionLabel}
                  className={styles["tree-permission-icon"]}
                />
              </Tooltip>
            )}
            {wikiReflectBadge && (
              <small
                className={cx(styles["tree-reflect-badge"], styles[`is-${wikiReflectBadge.tone}`])}
                title={wikiReflectBadge.description}
                aria-label={wikiReflectBadge.description}
              >
                {wikiReflectBadge.label}
              </small>
            )}
            {isUploading
              ? <small className={styles["tree-type-badge"]}>업로드 중</small>
              : conversionBadge
                ? (
                  <Tooltip content={conversionBadge.description} placement="right" disabled={Boolean(relatedDocumentId)} className={styles["tree-conversion-inline"]}>
                  <small
                    className={cx(styles["tree-type-badge"], styles["is-conversion"], relatedDocumentId && styles["is-link-placeholder"])}
                    aria-label={relatedDocumentId ? undefined : conversionBadge.description}
                    aria-hidden={relatedDocumentId ? true : undefined}
                  >
                    {conversionBadge.label}
                    {relatedDocumentId && <SidebarConversionLinkIcon className={styles["tree-conversion-icon"]} />}
                  </small>
                  </Tooltip>
                )
                : display.badge && <small className={styles["tree-type-badge"]}>{display.badge}</small>}
            {isFileDropTarget && <small className={styles["tree-drop-hint"]}>여기에 추가</small>}
          </>
        )}
      </button>
      {relatedDocumentId && conversionBadge && (
        <Tooltip content={conversionBadge.description} placement="right" describe={false} className={styles["tree-conversion-tooltip"]}>
        <Link
          className={cx(styles["tree-type-badge"], styles["is-conversion"], styles["tree-conversion-link"])}
          href={buildWorkspaceHref({ kind: "document", documentId: relatedDocumentId })}
          prefetch={false}
          draggable={false}
          aria-label={conversionBadge.description}
          onClick={(event) => {
            event.stopPropagation();
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) interaction.onClearSelectedItems();
          }}
        >
          {conversionBadge.label}
          <SidebarConversionLinkIcon className={styles["tree-conversion-icon"]} />
        </Link>
        </Tooltip>
      )}
      {canShowFolderAction && (
        <button
          type="button"
          className={styles["tree-row-action"]}
          aria-label={`${item.label}에 추가`}
          aria-haspopup="menu"
          data-folder-menu-trigger=""
          onClick={(event) => {
            // 행 토글·선택 해제로 전파되지 않게 막는다.
            event.stopPropagation();
            interaction.onOpenFolderMenuAt(projectId, item.id, event.currentTarget);
          }}
          onContextMenu={(event) => interaction.onContextMenuItem(event, projectId, item.id)}
        >
          <SvgIcon src={plusIcon} className={styles["tree-row-action-icon"]} />
        </button>
      )}
      </div>
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
          inheritedPermission={permissionForChildren(item, inheritedPermission)}
        />
      ))}
    </div>
  );
}
