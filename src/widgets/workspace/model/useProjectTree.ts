import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { convertDocumentToMarkdown, deleteDocument, renameDocument } from "@/entities/document";
import { createFolder, renameFolder, deleteFolder, moveFolder, moveDocument } from "@/entities/tree/api/folders";
import { ROOT_DOCUMENTS_PROJECT_ID } from "@/entities/tree/lib/serverTree";
import { publishNotice } from "@/features/document-notifications";
import { getErrorMessage } from "@/shared/lib/errors";
import { createSerialQueue } from "@/shared/lib/serialQueue";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";
import { resolveTreeMove } from "../lib/treeMoveRules";
import { collectDeletedTreeIds, type DeletedTreeIds } from "../lib/deletedTreeIds";
import {
  findTreeItem,
  availableFolderName,
  folderNames,
  findItemLocation,
  serverFolderId,
  normalizeTreeName,
  initialProjects,
  isFileItem,
  isWikiItem
} from "@/entities/tree";
import type { ContextMenuState, DropTarget, EditingState, FileDropTarget, FolderLocation, Project } from "@/entities/tree";

/** 큐에서 기다리는 동안 대상이 삭제·이동되면 요청을 보내지 않고 이 문구로 알린다. */
const STALE_TARGET_MESSAGE = "대상이 이미 삭제되었거나 이동되어 요청을 보내지 않았습니다.";

function hasTreeItem(projects: Project[], itemId: string) {
  return findItemLocation(projects, itemId) !== undefined;
}

function hasFolderLocation(projects: Project[], location: FolderLocation) {
  const project = projects.find((entry) => entry.id === location.projectId);
  return Boolean(project && (location.folderId === null || findTreeItem(project.items, location.folderId)));
}


/** 삭제 확인 모달이 필요로 하는 대상 정보. contextMenu가 닫힌 뒤에도 삭제를 실행할 수 있도록 스냅샷한다. */
type DeleteConfirmTarget = {
  projectId: string;
  itemId: string | null;
  documentId?: string;
  label: string;
  kind: "folder" | "document";
};

/** 문서 위에 문서를 놓아 새 묶음 폴더를 만들기 전 확인 모달이 필요로 하는 정보. */
type MergeConfirmTarget = {
  sourceLabel: string;
  targetLabel: string;
  run: () => void;
};

export function useProjectTree({
  refreshRef,
  onDeleted
}: {
  refreshRef: MutableRefObject<() => Promise<void>>;
  /** 삭제 API가 성공한 뒤 호출된다. 폴더를 지우면 삭제 직전 트리의 하위 id까지 넘긴다. */
  onDeleted?: (deleted: DeletedTreeIds) => void;
}) {
  // 큐에서 늦게 실행되는 삭제도 최신 렌더의 콜백을 부르도록 ref로 들고 있는다.
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;
  const [projects, setProjectsState] = useState<Project[]>(initialProjects);
  // 큐의 작업은 실행 시점의 최신 트리를 읽어야 한다. 렌더를 기다리지 않도록 갱신과 동시에 ref에 반영한다.
  const projectsRef = useRef<Project[]>(initialProjects);
  const setProjects = useCallback<Dispatch<SetStateAction<Project[]>>>((next) => {
    const value = typeof next === "function" ? next(projectsRef.current) : next;
    projectsRef.current = value;
    setProjectsState(value);
  }, []);
  const [draggedItem, setDraggedItem] = useState<{ projectId: string; itemId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [fileDropTarget, setFileDropTarget] = useState<FileDropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmTarget | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState<MergeConfirmTarget | null>(null);
  // Cmd/Ctrl+클릭으로 고른 이동 대상. Escape나 일반 클릭으로 해제한다.
  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const editingCancelRef = useRef(false);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const clearSelectedItems = useCallback(() => setSelectedItemIds(new Set()), []);
  useEscapeKey(contextMenu !== null, closeContextMenu);
  useEscapeKey(selectedItemIds.size > 0, clearSelectedItems);

  useEffect(() => {
    if (!contextMenu) return;
    window.addEventListener("click", closeContextMenu);
    return () => window.removeEventListener("click", closeContextMenu);
  }, [contextMenu, closeContextMenu]);

  function toggleSelectedItem(itemId: string) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // 동시 변경은 막아야 하지만, 진행 중인 변경이 있다고 다음 변경을 버리면
  // 사용자는 요청도 안내도 없이 메뉴가 닫히는 것만 본다. 직렬로 줄을 세운다.
  // 작업은 큐에 넣을 때가 아니라 실행할 때의 최신 트리(latest)로 이름과 대상을 정한다.
  const enqueueMutation = useRef(createSerialQueue()).current;
  function runTreeMutation(action: (latest: Project[]) => Promise<void>, title: string): Promise<void> {
    return enqueueMutation(async () => {
      try { await action(projectsRef.current); }
      catch (error) { publishNotice({ kind: "failed", title, message: getErrorMessage(error, "변경하지 못했습니다.") }); }
      finally { await refreshRef.current().catch(() => {}); }
    });
  }

  function addProject() {
    const context = contextMenu;
    const project = context && projects.find((entry) => entry.id === context.projectId);
    const target = project && context?.itemId ? findTreeItem(project.items, context.itemId) : null;
    const location = context && project ? target && isFileItem(target) ? findItemLocation(projects, target.id) ?? undefined : {
      projectId: project.id,
      folderId: target && !isFileItem(target) && !isWikiItem(target) ? target.id : null
    } : undefined;
    setContextMenu(null);
    void runTreeMutation(async (latest) => {
      if (location && !hasFolderLocation(latest, location)) throw new Error(STALE_TARGET_MESSAGE);
      const parentId = location ? serverFolderId(latest, location) : null;
      const folder = await createFolder(availableFolderName(latest, "새 폴더", location), parentId);
      editingCancelRef.current = false;
      // 루트 폴더도 트리 행이므로 재조회 후 나타나는 행에서 바로 이름을 편집한다.
      setEditing({ projectId: location?.projectId ?? ROOT_DOCUMENTS_PROJECT_ID, itemId: folder.id, label: folder.name });
    }, "폴더 생성 실패");
  }

  function moveTreeEntry(target: DropTarget) {
    const dragged = draggedItem;
    setDropTarget(null);
    setDraggedItem(null);
    const resolution = resolveTreeMove(projects, dragged, target, selectedItemIds);
    if (resolution.kind === "invalid") return;
    if (resolution.kind === "conflict") {
      publishNotice({ kind: "failed", title: "이동 실패", message: "대상 폴더에 같은 이름의 항목이 있습니다." });
      return;
    }
    if (resolution.kind === "cycle") {
      publishNotice({ kind: "failed", title: "이동 실패", message: "폴더를 자기 자신이나 하위 폴더 안으로 옮길 수 없습니다." });
      return;
    }
    if (resolution.kind === "move-many") {
      const { items: selectedItems, destination, folderId } = resolution;
      setSelectedItemIds(new Set());
      void runTreeMutation(async (latest) => {
        if (!hasFolderLocation(latest, destination)) throw new Error(STALE_TARGET_MESSAGE);
        // 기다리는 동안 사라진 항목은 빼고 옮긴다.
        const items = selectedItems.filter((entry) => hasTreeItem(latest, entry.id));
        if (items.length === 0) throw new Error(STALE_TARGET_MESSAGE);
        // 하나가 실패해도 나머지는 계속 옮기고, 몇 개가 실패했는지 알린다. finally의 재조회가 실제 위치를 보여준다.
        const results = await Promise.allSettled(items.map((entry) =>
          entry.documentId ? moveDocument(entry.documentId, folderId) : moveFolder(entry.id, folderId)
        ));
        const failed = results.filter((result) => result.status === "rejected").length;
        if (failed > 0) throw new Error(`${items.length}개 중 ${failed}개 항목을 옮기지 못했습니다.`);
      }, "항목 이동 실패");
      return;
    }
    if (resolution.kind === "merge") {
      // 새 폴더가 생기는 동작이라 바로 실행하지 않고 확인 모달을 연다. 실제 생성은 confirmMerge에서 수행한다.
      const { sourceItem, targetItem, destination, folderId } = resolution;
      const sourceDocumentId = sourceItem.documentId as string;
      const targetDocumentId = targetItem.documentId as string;
      setMergeConfirm({
        sourceLabel: sourceItem.label,
        targetLabel: targetItem.label,
        run: () => void runTreeMutation(async (latest) => {
          if (!hasTreeItem(latest, sourceItem.id) || !hasTreeItem(latest, targetItem.id) || !hasFolderLocation(latest, destination)) {
            throw new Error(STALE_TARGET_MESSAGE);
          }
          const folder = await createFolder(availableFolderName(latest, "새 문서 묶음", destination), folderId);
          // 부분 실패 시에도 최종 서버 위치를 재조회해 실제 상태를 표시한다.
          await moveDocument(targetDocumentId, folder.id);
          await moveDocument(sourceDocumentId, folder.id);
        }, "문서 묶음 생성 실패")
      });
      return;
    }
    const { item, destination, folderId, position } = resolution;
    void runTreeMutation(async (latest) => {
      if (!hasTreeItem(latest, item.id) || !hasFolderLocation(latest, destination)) throw new Error(STALE_TARGET_MESSAGE);
      if (item.documentId) await moveDocument(item.documentId, folderId, position);
      else await moveFolder(item.id, folderId, position);
    }, "항목 이동 실패");
  }

  function confirmMerge() {
    if (!mergeConfirm) return;
    const { run } = mergeConfirm;
    setMergeConfirm(null);
    run();
  }

  function cancelMerge() {
    setMergeConfirm(null);
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

  /** 컨텍스트 메뉴가 가리키는 폴더 위치(새 노트·파일 업로드 대상). 파일 위면 그 파일의 부모 폴더다. */
  function takeFolderTargetFromContext(): FileDropTarget | null {
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

  // Markdown 변환을 요청한다. 다른 트리 변경과 같은 경로를 써서
  // 성공·실패 모두 서버 상태로 재동기화하고, 실패는 알림으로 알린다.
  function convertContextTargetToMarkdown() {
    const itemId = contextMenuItem?.id;
    const documentId = contextMenuItem?.documentId;
    setContextMenu(null);
    if (!itemId || !documentId) return;
    void runTreeMutation(async (latest) => {
      if (!hasTreeItem(latest, itemId)) throw new Error(STALE_TARGET_MESSAGE);
      await convertDocumentToMarkdown(documentId);
    }, "Markdown 변환 실패");
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
    void runTreeMutation(async (latest) => {
      // 기다리는 동안 이미 사라졌으면 삭제 목적은 이뤄졌으므로 조용히 건너뛴다.
      if (itemId ? !hasTreeItem(latest, itemId) : !latest.some((project) => project.id === projectId)) return;
      const deleted = collectDeletedTreeIds(latest, projectId, itemId);
      if (kind === "folder") await deleteFolder(itemId ?? projectId);
      else if (documentId) await deleteDocument(documentId);
      else return;
      onDeletedRef.current?.(deleted);
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
    const isDuplicateName = (tree: Project[]) => !item?.documentId
      && folderNames(tree, itemId ?? projectId, itemId ? findItemLocation(tree, itemId) : undefined).has(normalizeTreeName(nextLabel));
    if (isDuplicateName(projects)) {
      publishNotice({ kind: "failed", title: "이름 변경 실패", message: "같은 폴더 안에 같은 이름의 항목이 있습니다." });
      return;
    }
    void runTreeMutation(async (latest) => {
      const exists = itemId ? hasTreeItem(latest, itemId) : latest.some((entry) => entry.id === projectId);
      if (!exists) throw new Error(STALE_TARGET_MESSAGE);
      // 기다리는 동안 같은 폴더에 같은 이름이 생겼을 수 있어 실행 시점에 다시 확인한다.
      if (isDuplicateName(latest)) throw new Error("같은 폴더 안에 같은 이름의 항목이 있습니다.");
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
    // 선택 밖의 항목을 끌면 선택은 의미가 없으므로 해제한다.
    if (!selectedItemIds.has(itemId)) setSelectedItemIds(new Set());
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
    mergeConfirm,
    confirmMerge,
    cancelMerge,
    selectedItemIds,
    toggleSelectedItem,
    clearSelectedItems,
    setFileDropTarget,
    addProject,
    moveTreeEntry,
    openFolderMenu,
    openProjectMenu,
    renameContextTarget,
    takeFolderTargetFromContext,
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
