import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { convertDocumentToMarkdown, deleteDocument, renameDocument } from "@/entities/document";
import { createFolder, renameFolder, deleteFolder, moveFolder, moveDocument } from "@/entities/tree/api/folders";
import { ROOT_DOCUMENTS_PROJECT_ID } from "@/entities/tree/lib/serverTree";
import { publishNotice } from "@/features/document-notifications";
import {
  findTreeItem,
  availableFolderName,
  folderNames,
  findItemLocation,
  serverFolderId,
  folderItems,
  normalizeTreeName,
  initialProjects,
  isFileItem,
  isWikiItem
} from "@/entities/tree";
import type { ContextMenuState, DropTarget, EditingState, FileDropTarget, Project } from "@/entities/tree";


/** 삭제 확인 모달이 필요로 하는 대상 정보. contextMenu가 닫힌 뒤에도 삭제를 실행할 수 있도록 스냅샷한다. */
type DeleteConfirmTarget = {
  projectId: string;
  itemId: string | null;
  documentId?: string;
  label: string;
  kind: "folder" | "document";
};

export function useProjectTree({ refreshRef }: { refreshRef: MutableRefObject<() => Promise<void>> }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [draggedItem, setDraggedItem] = useState<{ projectId: string; itemId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [fileDropTarget, setFileDropTarget] = useState<FileDropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmTarget | null>(null);
  const editingCancelRef = useRef(false);

  useEffect(() => {
    if (!contextMenu) return;

    function closeContextMenu() {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeContextMenu();
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const mutationRunningRef = useRef(false);
  async function runTreeMutation(action: () => Promise<void>, title: string) {
    if (mutationRunningRef.current) return;
    mutationRunningRef.current = true;
    try { await action(); }
    catch (error) { publishNotice({ kind: "failed", title, message: error instanceof Error ? error.message : "변경하지 못했습니다." }); }
    finally {
      await refreshRef.current().catch(() => {});
      mutationRunningRef.current = false;
    }
  }

  function addProject() {
    const context = contextMenu;
    const project = context && projects.find((entry) => entry.id === context.projectId);
    const target = project && context?.itemId ? findTreeItem(project.items, context.itemId) : null;
    const location = context && project ? target && isFileItem(target) ? findItemLocation(projects, target.id) ?? undefined : {
      projectId: project.id,
      folderId: target && !isFileItem(target) && !isWikiItem(target) ? target.id : null
    } : undefined;
    const parentId = location ? serverFolderId(projects, location) : null;
    setContextMenu(null);
    void runTreeMutation(async () => {
      const folder = await createFolder(availableFolderName(projects, "새 폴더", location), parentId);
      editingCancelRef.current = false;
      if (location && parentId !== null) {
        setEditing({ projectId: location.projectId, itemId: folder.id, label: folder.name });
      } else {
        setProjects((current) => [...current, { id: folder.id, folderId: folder.id, title: folder.name, currentVersion: folder.current_version, items: [] }]);
        setEditing({ projectId: folder.id, itemId: null, label: folder.name });
      }
    }, "폴더 생성 실패");
  }

  function moveTreeEntry(target: DropTarget) {
    const dragged = draggedItem;
    setDropTarget(null);
    setDraggedItem(null);
    if (!dragged) return;
    const source = projects.find((project) => project.id === dragged.projectId);
    const item = source && findTreeItem(source.items, dragged.itemId);
    const targetProject = projects.find((project) => project.id === target.projectId);
    const targetItem = targetProject && target.targetId ? findTreeItem(targetProject.items, target.targetId) : null;
    if (!item || !targetProject || isWikiItem(item) || item.id === targetItem?.id) return;
    if (isFileItem(item) && !item.documentId) return;
    const parent = targetItem ? findItemLocation(projects, targetItem.id) : { projectId: target.projectId, folderId: null };
    if (!parent) return;
    const destination = target.position === "inside" && targetItem && !isFileItem(targetItem)
      ? { projectId: target.projectId, folderId: targetItem.id } : parent;
    const siblings = folderItems(projects, destination).filter((sibling) => sibling.id !== item.id);
    const isMerge = target.position === "inside" && targetItem && isFileItem(item) && isFileItem(targetItem);
    const conflicting = isMerge
      ? normalizeTreeName(item.label) === normalizeTreeName(targetItem.label)
      : siblings.some((sibling) => normalizeTreeName(sibling.label) === normalizeTreeName(item.label));
    if (conflicting) {
      publishNotice({ kind: "failed", title: "이동 실패", message: "대상 폴더에 같은 이름의 항목이 있습니다." });
      return;
    }
    void runTreeMutation(async () => {
      const folderId = serverFolderId(projects, destination);
      if (isMerge && targetItem.documentId && item.documentId) {
        const folder = await createFolder(availableFolderName(projects, "새 문서 묶음", destination), folderId);
        // 부분 실패 시에도 최종 서버 위치를 재조회해 실제 상태를 표시한다.
        await moveDocument(targetItem.documentId, folder.id);
        await moveDocument(item.documentId, folder.id);
      } else {
        const index = targetItem ? siblings.findIndex((sibling) => sibling.id === targetItem.id) : -1;
        const position = target.position === "inside" || index < 0 ? undefined : index + (target.position === "after" ? 1 : 0);
        if (item.documentId) await moveDocument(item.documentId, folderId, position);
        else await moveFolder(item.id, folderId, position);
      }
    }, "항목 이동 실패");
  }

  function openFolderMenu(event: ReactMouseEvent<HTMLButtonElement>, projectId: string, itemId: string) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ projectId, itemId, x: event.clientX, y: event.clientY });
  }

  function openProjectMenu(event: ReactMouseEvent<HTMLElement>, projectId: string) {
    event.preventDefault();
    setContextMenu({ projectId, itemId: null, x: event.clientX, y: event.clientY });
  }

  function renameContextTarget() {
    if (!contextMenu || contextMenu.projectId === ROOT_DOCUMENTS_PROJECT_ID && contextMenu.itemId === null) return;
    const project = projects.find((project) => project.id === contextMenu.projectId);
    if (!project) return;
    editingCancelRef.current = false;
    if (contextMenu.itemId === null) {
      setEditing({ projectId: contextMenu.projectId, itemId: null, label: project.title });
    } else {
      const item = findTreeItem(project.items, contextMenu.itemId);
      // PDF 원본은 편집 불가 문서라 이름 변경을 허용하지 않는다.
      if (!item || item.generated || item.mimeType === "application/pdf") return;
      setEditing({ projectId: contextMenu.projectId, itemId: contextMenu.itemId, label: item.label });
    }
    setContextMenu(null);
  }

  function takeMarkdownTargetFromContext(): FileDropTarget | null {
    if (!contextMenu) return null;
    const project = projects.find((project) => project.id === contextMenu.projectId);
    const item = contextMenu.itemId && project ? findTreeItem(project.items, contextMenu.itemId) : null;
    const target = item && isFileItem(item) ? findItemLocation(projects, item.id) : {
      projectId: contextMenu.projectId,
      folderId: item && !isFileItem(item) && !isWikiItem(item) ? item.id : null
    };
    setContextMenu(null);
    return target ?? null;
  }

  // 컨텍스트 메뉴 대상이 PDF 원본 문서일 때만 Markdown 변환 메뉴를 노출한다.
  const contextMenuProject = contextMenu ? projects.find((project) => project.id === contextMenu.projectId) : null;
  const contextMenuItem = contextMenu?.itemId && contextMenuProject
    ? findTreeItem(contextMenuProject.items, contextMenu.itemId)
    : null;
  // PDF 원본은 편집 불가 문서라 컨텍스트 메뉴에서 이름 변경을 숨긴다.
  const canRenameContextTarget = !(contextMenu?.projectId === ROOT_DOCUMENTS_PROJECT_ID && contextMenu.itemId === null) && contextMenuItem?.mimeType !== "application/pdf";

  const convertContextTarget = contextMenuItem?.documentId && contextMenuItem.mimeType === "application/pdf"
    ? {
      // 원본이 아직 처리 중이면 변환을 시작할 수 없어 비활성화한다.
      isDisabled: contextMenuItem.status === "uploading" || contextMenuItem.status === "processing"
    }
    : null;

  // Markdown 변환을 요청한다. 성공·실패 모두 서버 상태로 재동기화해
  // 새 문서가 '변환 중' 상태로 목록에 나타나게 한다.
  function convertContextTargetToMarkdown() {
    const documentId = contextMenuItem?.documentId;
    setContextMenu(null);
    if (!documentId) return;
    void convertDocumentToMarkdown(documentId)
      .then(() => refreshRef.current())
      .catch(() => refreshRef.current());
  }

  // 컨텍스트 메뉴의 삭제는 즉시 실행하지 않고 확인 모달을 연다. 실제 삭제는 confirmDelete에서 수행한다.
  function deleteContextTarget() {
    if (!contextMenu) return;
    if (contextMenu.projectId === ROOT_DOCUMENTS_PROJECT_ID && contextMenu.itemId === null) return;
    const projectId = contextMenu.projectId;
    const project = projects.find((project) => project.id === projectId);
    if (contextMenu.itemId === null) {
      setDeleteConfirm({ projectId, itemId: null, label: project?.title ?? "폴더", kind: "folder" });
      setContextMenu(null);
      return;
    }
    const item = project ? findTreeItem(project.items, contextMenu.itemId) : null;
    const isFolder = item ? (!isFileItem(item) && !isWikiItem(item)) : false;
    setDeleteConfirm({
      projectId,
      itemId: contextMenu.itemId,
      documentId: item?.documentId,
      label: item?.label ?? "항목",
      kind: isFolder ? "folder" : "document"
    });
    setContextMenu(null);
  }

  function confirmDelete() {
    if (!deleteConfirm) return;
    const { projectId, itemId, documentId, kind } = deleteConfirm;
    setDeleteConfirm(null);
    void runTreeMutation(async () => {
      if (kind === "folder") await deleteFolder(itemId ?? projectId);
      else if (documentId) await deleteDocument(documentId);
    }, "삭제 실패");
  }

  function cancelDelete() {
    setDeleteConfirm(null);
  }

  function commitEditing() {
    if (editingCancelRef.current) { editingCancelRef.current = false; setEditing(null); return; }
    if (!editing) return;
    const { projectId, itemId, label } = editing;
    setEditing(null);
    const nextLabel = label.trim().normalize("NFC");
    if (!nextLabel) return;
    const project = projects.find((project) => project.id === projectId);
    const item = itemId && project ? findTreeItem(project.items, itemId) : null;
    const location = itemId ? findItemLocation(projects, itemId) : undefined;
    if (!item?.documentId && folderNames(projects, itemId ?? projectId, location).has(normalizeTreeName(nextLabel))) {
      publishNotice({ kind: "failed", title: "이름 변경 실패", message: "같은 폴더 안에 같은 이름의 항목이 있습니다." });
      return;
    }
    void runTreeMutation(async () => {
      if (item?.documentId) await renameDocument(item.documentId, nextLabel);
      else if (projectId !== ROOT_DOCUMENTS_PROJECT_ID || itemId) await renameFolder(itemId ?? projectId, nextLabel);
    }, "이름 변경 실패");
  }

  function cancelEditing() {
    editingCancelRef.current = true;
    setEditing(null);
  }

  async function renameDocumentById(documentId: string, nextLabel: string) {
    try { await renameDocument(documentId, nextLabel); }
    finally { await refreshRef.current().catch(() => {}); }
  }

  function onDragStart(projectId: string, itemId: string) {
    setDraggedItem({ projectId, itemId });
    setContextMenu(null);
  }

  function onDragOverItem(target: DropTarget) {
    if (draggedItem) setDropTarget(target);
  }

  function onFileDragLeave() {
    setFileDropTarget(null);
  }

  function onDragEnd() {
    setDraggedItem(null);
    setDropTarget(null);
    setFileDropTarget(null);
  }

  function onEditingChange(label: string) {
    setEditing((current) => current ? { ...current, label } : current);
  }

  return {
    projects,
    setProjects,
    draggedItem,
    dropTarget,
    fileDropTarget,
    contextMenu,
    editing,
    deleteConfirm,
    setFileDropTarget,
    addProject,
    moveTreeEntry,
    openFolderMenu,
    openProjectMenu,
    renameContextTarget,
    takeMarkdownTargetFromContext,
    canRenameContextTarget,
    convertContextTarget,
    convertContextTargetToMarkdown,
    deleteContextTarget,
    confirmDelete,
    cancelDelete,
    commitEditing,
    cancelEditing,
    renameDocumentById,
    onDragStart,
    onDragOverItem,
    onFileDragLeave,
    onDragEnd,
    onEditingChange
  };
}
