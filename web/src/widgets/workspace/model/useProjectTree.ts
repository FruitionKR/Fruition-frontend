import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from "react";
import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { convertDocumentToMarkdown, deleteDocument, renameDocument } from "@/entities/document";
import { canConvertDocument, CONVERT_FORBIDDEN_REASON, permissionChangedMessage } from "@/entities/document/lib/documentAccess";
import { setDocumentPermission, setFolderPermission } from "@/entities/document/api/permission";
import type { DocumentPermission } from "@/entities/document/model/document";
import type { PermissionDialogTarget } from "@/widgets/document-sidebar/ui/PermissionDialog";
import { createFolder, renameFolder, deleteFolder, moveFolder, moveDocument } from "@/entities/tree/api/documentTree";
import { ROOT_DOCUMENTS_PROJECT_ID } from "@/entities/tree/lib/projectsFromServerTree";
import { useTreeReasonText } from "@/entities/tree/model/useTreeReasonText";
import { publishNotice } from "@/features/document-notifications";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { createSerialQueue } from "@/shared/lib/serialQueue";
import { useEscapeLayer } from "@/shared/hooks/useEscapeLayer";
import { isDropDeniedByFolder, moveDeniedReason, resolveTreeMove } from "../lib/treeMoveRules";
import { planBulkDelete, rangeSelection, summarizeBulkResult, type SkippedTreeItem } from "../lib/treeBulkSelection";
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
  canWriteTreeFolder,
  FOLDER_WRITE_FORBIDDEN_MESSAGE
} from "@/entities/tree";
import type { ContextMenuState, DropTarget, EditingState, FileDropTarget, FolderLocation, Project } from "@/entities/tree";

/** + 버튼 아래로 메뉴를 띄울 때 버튼과의 간격 (px) */
const FOLDER_MENU_ANCHOR_GAP_PX = 4;

/** 트리 변경 실패 알림 종류. 제목과 알림 설정 항목이 종류마다 다르다. */
type TreeMutationFailure = "folderCreate" | "move" | "documentGroup" | "convert" | "delete" | "rename";

const TREE_FAILURE_NOTIFICATION_KEYS = {
  folderCreate: "folderCreateFailed",
  move: "moveFailed",
  documentGroup: "documentGroupFailed",
  convert: "pdfConvertFailed",
  delete: "deleteFailed",
  rename: "renameFailed"
} as const satisfies Record<TreeMutationFailure, string>;

const BULK_NOTIFICATION_KEYS = {
  move: { completed: "moveCompleted", failed: "moveFailed" },
  delete: { completed: "deleteCompleted", failed: "deleteFailed" }
} as const;

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

/** 묶음 삭제 확인 모달이 필요로 하는 정보. 모달을 연 시점의 선택을 스냅샷한다. */
type BulkDeleteConfirmTarget = {
  items: { id: string; label: string; kind: "folder" | "document" }[];
  skipped: SkippedTreeItem[];
};

/** 문서 위에 문서를 놓아 새 묶음 폴더를 만들기 전 확인 모달이 필요로 하는 정보. */
type MergeConfirmTarget = {
  sourceLabel: string;
  targetLabel: string;
  /** 만들어질 묶음 폴더 이름. 확인 모달 문구와 실제로 만드는 폴더 이름을 맞춘다. */
  folderLabel: string;
  run: () => void;
};

export function useProjectTree({
  refreshRef,
  onDeleted,
  isWorkspaceOwner
}: {
  refreshRef: MutableRefObject<() => Promise<void>>;
  /** 삭제 API가 성공한 뒤 호출된다. 폴더를 지우면 삭제 직전 트리의 하위 id까지 넘긴다. */
  onDeleted?: (deleted: DeletedTreeIds) => void;
  /** 폴더에 넣기·꺼내기 판단에 쓴다. 역할을 아직 모르면 null이고 막지 않는다. */
  isWorkspaceOwner: boolean | null;
}) {
  // 큐에서 늦게 실행되는 삭제도 최신 렌더의 콜백을 부르도록 ref로 들고 있는다.
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;
  const t = useTranslations("workspace.tree");
  const tShared = useTranslations("shared");
  const tPermission = useTranslations("documents.permission");
  const reasonText = useTreeReasonText();
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
  const [dropDeniedItemId, setDropDeniedItemId] = useState<string | null>(null);
  const [fileDropTarget, setFileDropTarget] = useState<FileDropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmTarget | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState<MergeConfirmTarget | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<PermissionDialogTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ projectId: string; itemId: string } | null>(null);
  // 변환 품질 안내를 확인받는 동안의 변환 대상
  const [convertConfirm, setConvertConfirm] = useState<{ itemId: string; documentId: string; label: string } | null>(null);
  // Cmd/Ctrl+클릭·Shift+클릭으로 고른 묶음 이동·삭제 대상. Escape·일반 클릭·빈 영역 클릭으로 해제한다.
  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<BulkDeleteConfirmTarget | null>(null);
  // Shift+클릭 범위의 시작 행. 마지막으로 누른 행이다(렌더에 쓰지 않아 ref로 둔다).
  const selectionAnchorRef = useRef<string | null>(null);
  const editingCancelRef = useRef(false);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  /** 선택을 비운다. anchorItemId를 주면 그 행을 다음 Shift+클릭의 시작으로 삼는다(일반 클릭). */
  const clearSelectedItems = useCallback((anchorItemId?: string) => {
    if (anchorItemId !== undefined) selectionAnchorRef.current = anchorItemId;
    setSelectedItemIds((current) => current.size === 0 ? current : new Set());
  }, []);
  // 선택 해제는 모달·메뉴 등 열린 레이어가 없을 때만 Escape로 처리한다.
  useEscapeLayer(selectedItemIds.size > 0, () => clearSelectedItems(), "fallback");

  function toggleSelectedItem(itemId: string) {
    selectionAnchorRef.current = itemId;
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  /**
   * Shift+클릭: 시작 행부터 itemId까지 보이는 행을 고른다(기존 선택은 바꾼다).
   * 시작 행이 없으면 지금 열린 문서 행(fallbackAnchorId)에서 시작한다. 시작 행은 그대로 둬 범위를 다시 넓힐 수 있다.
   */
  function selectItemRange(itemId: string, visibleIds: readonly string[], fallbackAnchorId: string | null) {
    const anchorId = selectionAnchorRef.current ?? fallbackAnchorId;
    selectionAnchorRef.current = anchorId ?? itemId;
    setSelectedItemIds(new Set(rangeSelection(visibleIds, anchorId, itemId)));
  }

  // 동시 변경은 막아야 하지만, 진행 중인 변경이 있다고 다음 변경을 버리면
  // 사용자는 요청도 안내도 없이 메뉴가 닫히는 것만 본다. 직렬로 줄을 세운다.
  // 작업은 큐에 넣을 때가 아니라 실행할 때의 최신 트리(latest)로 이름과 대상을 정한다.
  const enqueueMutation = useRef(createSerialQueue()).current;
  function runTreeMutation(action: (latest: Project[]) => Promise<void>, failure: TreeMutationFailure): Promise<void> {
    return enqueueMutation(async () => {
      try { await action(projectsRef.current); }
      catch (error) {
        publishNotice({
          kind: "failed",
          notificationKey: TREE_FAILURE_NOTIFICATION_KEYS[failure],
          title: t(`failed.${failure}`),
          message: getErrorMessage(error, t("changeFailed"), tShared)
        });
      }
      finally { await refreshRef.current().catch(() => {}); }
    });
  }

  /** 묶음 이동·삭제 결과 알림. 실패·건너뜀은 앞에서부터 이유와 함께 나열한다. */
  function bulkNotice(action: "move" | "delete", succeeded: number, failures: readonly SkippedTreeItem[]) {
    const summary = summarizeBulkResult(succeeded, failures);
    const lines = [
      summary.failed === 0
        ? t(`bulk.${action}.done`, { count: summary.succeeded })
        : t("bulk.counts", { succeeded: summary.succeeded, failed: summary.failed }),
      ...summary.listed.map((entry) => t("bulk.failureItem", { label: entry.label, reason: reasonText(entry.reason) })),
      ...(summary.restCount > 0 ? [t("bulk.more", { count: summary.restCount })] : [])
    ];
    const kind = summary.outcome === "completed" ? "completed" as const : "failed" as const;
    return {
      kind,
      notificationKey: BULK_NOTIFICATION_KEYS[action][kind],
      title: t(`bulk.${action}.${summary.outcome}`),
      message: lines.join("\n")
    };
  }

  function addProject() {
    const context = contextMenu;
    const project = context && projects.find((entry) => entry.id === context.projectId);
    const target = project && context?.itemId ? findTreeItem(project.items, context.itemId) : null;
    const location = context && project ? target && isFileItem(target) ? findItemLocation(projects, target.id) ?? undefined : {
      projectId: project.id,
      folderId: target && !isFileItem(target) ? target.id : null
    } : undefined;
    setContextMenu(null);
    void runTreeMutation(async (latest) => {
      if (location && !hasFolderLocation(latest, location)) throw new Error(t("staleTarget"));
      const parentId = location ? serverFolderId(latest, location) : null;
      const folder = await createFolder(availableFolderName(latest, t("newFolderName"), location), parentId);
      editingCancelRef.current = false;
      // 루트 폴더도 트리 행이므로 재조회 후 나타나는 행에서 바로 이름을 편집한다.
      setEditing({ projectId: location?.projectId ?? ROOT_DOCUMENTS_PROJECT_ID, itemId: folder.id, label: folder.name });
    }, "folderCreate");
  }

  function moveTreeEntry(target: DropTarget, dragged = draggedItem) {
    setDropTarget(null);
    setDraggedItem(null);
    setDropDeniedItemId(null);
    const resolution = resolveTreeMove(projects, dragged, target, selectedItemIds, isWorkspaceOwner);
    if (resolution.kind === "invalid") return;
    if (resolution.kind === "forbidden") {
      publishNotice({ kind: "failed", notificationKey: "moveFailed", title: t("failed.move"), message: reasonText(FOLDER_WRITE_FORBIDDEN_MESSAGE) });
      return;
    }
    if (resolution.kind === "conflict") {
      publishNotice({ kind: "failed", notificationKey: "moveFailed", title: t("failed.move"), message: t("duplicateInDestination") });
      return;
    }
    if (resolution.kind === "cycle") {
      publishNotice({ kind: "failed", notificationKey: "moveFailed", title: t("failed.move"), message: t("moveIntoOwnSubtree") });
      return;
    }
    if (resolution.kind === "move-many") {
      const { items: selectedItems, skipped, destination, folderId } = resolution;
      setSelectedItemIds(new Set());
      void runTreeMutation(async (latest) => {
        if (!hasFolderLocation(latest, destination)) throw new Error(t("staleTarget"));
        const failures = [...skipped];
        let moved = 0;
        // 트리 순서대로 하나씩 대상 폴더 끝에 붙여 상대 순서를 지킨다. 하나가 실패해도 나머지는 계속 옮긴다.
        for (const entry of selectedItems) {
          // 기다리는 동안 사라진 항목은 건너뛴다.
          if (!hasTreeItem(latest, entry.id)) {
            failures.push({ label: entry.label, reason: t("staleTarget") });
            continue;
          }
          try {
            if (entry.documentId) await moveDocument(entry.documentId, folderId);
            else await moveFolder(entry.id, folderId);
            moved += 1;
          } catch (error) {
            failures.push({ label: entry.label, reason: getErrorMessage(error, t("moveItemFailed"), tShared) });
          }
        }
        // 결과는 한 번만 알리고, finally의 재조회가 실제 위치를 보여준다.
        publishNotice(bulkNotice("move", moved, failures));
      }, "move");
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
        folderLabel: availableFolderName(projects, t("newDocumentGroupName"), destination),
        run: () => void runTreeMutation(async (latest) => {
          if (!hasTreeItem(latest, sourceItem.id) || !hasTreeItem(latest, targetItem.id) || !hasFolderLocation(latest, destination)) {
            throw new Error(t("staleTarget"));
          }
          const folder = await createFolder(availableFolderName(latest, t("newDocumentGroupName"), destination), folderId);
          // 부분 실패 시에도 최종 서버 위치를 재조회해 실제 상태를 표시한다.
          await moveDocument(targetDocumentId, folder.id);
          await moveDocument(sourceDocumentId, folder.id);
        }, "documentGroup")
      });
      return;
    }
    const { item, destination, folderId, position } = resolution;
    void runTreeMutation(async (latest) => {
      if (!hasTreeItem(latest, item.id) || !hasFolderLocation(latest, destination)) throw new Error(t("staleTarget"));
      if (item.documentId) await moveDocument(item.documentId, folderId, position);
      else await moveFolder(item.id, folderId, position);
    }, "move");
  }

  /** 터치 기기의 이동 대상 고르기: 메뉴의 "다른 폴더로 이동"에서 연다. */
  function openMoveContextTarget() {
    if (!contextMenu?.itemId) return;
    setMoveTarget({ projectId: contextMenu.projectId, itemId: contextMenu.itemId });
    if (!selectedItemIds.has(contextMenu.itemId)) setSelectedItemIds(new Set());
    setContextMenu(null);
  }

  /** 터치 기기의 묶음 이동: 고른 항목 중 하나를 끈 것처럼 처리하면 resolveTreeMove가 묶음 전체를 옮긴다. */
  function openMoveSelectedItems(projectId: string) {
    const [itemId] = selectedItemIds;
    if (itemId) setMoveTarget({ projectId, itemId });
  }

  function confirmMoveTo(folderId: string | null) {
    if (!moveTarget) return;
    setMoveTarget(null);
    moveTreeEntry({ projectId: moveTarget.projectId, targetId: folderId, position: "inside" }, moveTarget);
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
    // 선택 밖의 행을 우클릭하면 그 행 하나의 메뉴를 열므로 묶음 선택은 해제한다.
    if (!selectedItemIds.has(itemId)) clearSelectedItems();
    setContextMenu({ projectId, itemId, x: event.clientX, y: event.clientY });
  }

  /**
   * 행 ⋯ 버튼·새 노트 추가 버튼: 버튼 아래에 우클릭과 같은 메뉴를 열고, 같은 버튼으로 다시 누르면 닫는다. itemId가 null이면 최상위다.
   * source로 연 버튼을 기록해 새 노트 추가 메뉴는 새 노트 항목에 포커스를 둔다.
   */
  function openFolderMenuAt(projectId: string, itemId: string | null, anchor: HTMLElement, source?: ContextMenuState["source"]) {
    if (contextMenu?.projectId === projectId && contextMenu.itemId === itemId && contextMenu.source === source) {
      setContextMenu(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setContextMenu({ projectId, itemId, x: rect.left, y: rect.bottom + FOLDER_MENU_ANCHOR_GAP_PX, source });
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
      // PDF 원본은 편집 불가 문서라 이름 변경을 허용하지 않는다. 보기 권한만 있는 문서와 채팅에서 만든 문서도 같다.
      if (!item || item.generated || item.mimeType === "application/pdf" || item.canEdit === false || item.titleLocked) return;
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
      folderId: item && !isFileItem(item) ? item.id : null
    };
    setContextMenu(null);
    return target ?? null;
  }

  // 컨텍스트 메뉴 대상이 PDF 원본 문서일 때만 Markdown 변환 메뉴를 노출한다.
  const contextMenuProject = contextMenu ? projects.find((project) => project.id === contextMenu.projectId) : null;
  const contextMenuItem = contextMenu?.itemId && contextMenuProject
    ? findTreeItem(contextMenuProject.items, contextMenu.itemId)
    : null;
  // 메뉴 항목 노출은 사이드바가 treeItemMenuAccess로 판정한다. 여기 핸들러는 실행 직전에 다시 확인한다.

  /** 컨텍스트 메뉴 → 권한 설정: 대상을 스냅샷해 다이얼로그를 연다. */
  function openPermissionContextTarget() {
    if (!contextMenuItem) return;
    setPermissionTarget({
      kind: isFileItem(contextMenuItem) ? "document" : "folder",
      id: contextMenuItem.documentId ?? contextMenuItem.id,
      label: contextMenuItem.label,
      permission: contextMenuItem.permission ?? null
    });
    setContextMenu(null);
  }

  /** 다이얼로그 저장: 실패는 다이얼로그가 보여주도록 그대로 던지고, 성공·실패 모두 트리를 다시 받는다. 성공하면 알림으로 결과를 알린다. */
  async function applyPermission(access: DocumentPermission | null) {
    if (!permissionTarget) return;
    try {
      const result = permissionTarget.kind === "document"
        ? await setDocumentPermission(permissionTarget.id, access)
        : await setFolderPermission(permissionTarget.id, access);
      // 서버가 확정한 값(access)을 우선하고, 응답에 없으면 요청한 값으로 안내한다.
      const savedAccess = result?.access !== undefined ? result.access : access;
      publishNotice({ kind: "completed", notificationKey: "permissionChanged", title: t("permissionChangedTitle"), message: permissionChangedMessage(permissionTarget.label, savedAccess, tPermission) });
    } finally {
      await refreshRef.current().catch(() => {});
    }
  }

  // 변환 권한이 없으면(can_convert=false) 이유와 함께 비활성화한다. 필드가 없는 구 서버는 지금처럼 요청한다.
  const canConvertContextItem = canConvertDocument(contextMenuItem ? { can_convert: contextMenuItem.canConvert } : null);
  const convertContextTarget = contextMenuItem?.documentId && contextMenuItem.mimeType === "application/pdf"
    ? {
      // 원본이 아직 처리 중이면 변환을 시작할 수 없어 비활성화한다.
      isDisabled: !canConvertContextItem || contextMenuItem.status === "uploading" || contextMenuItem.status === "processing",
      disabledReason: canConvertContextItem ? undefined : CONVERT_FORBIDDEN_REASON
    }
    : null;


  // Markdown 변환은 바로 요청하지 않고 변환 품질 안내 확인 모달을 연다. 실제 변환은 confirmConvert에서 한다.
  function convertContextTargetToMarkdown() {
    const itemId = contextMenuItem?.id;
    const documentId = contextMenuItem?.documentId;
    const label = contextMenuItem?.label ?? "";
    setContextMenu(null);
    if (!itemId || !documentId || !canConvertContextItem) return;
    setConvertConfirm({ itemId, documentId, label });
  }

  // Markdown 변환을 요청한다. 다른 트리 변경과 같은 경로를 써서
  // 성공·실패 모두 서버 상태로 재동기화하고, 실패는 알림으로 알린다.
  function confirmConvert() {
    if (!convertConfirm) return;
    const { itemId, documentId } = convertConfirm;
    setConvertConfirm(null);
    void runTreeMutation(async (latest) => {
      if (!hasTreeItem(latest, itemId)) throw new Error(t("staleTarget"));
      await convertDocumentToMarkdown(documentId);
    }, "convert");
  }

  // 컨텍스트 메뉴의 삭제는 즉시 실행하지 않고 확인 모달을 연다. 실제 삭제는 confirmDelete에서 수행한다.
  function deleteContextTarget() {
    if (!contextMenu) return;
    if (contextMenu.projectId === ROOT_DOCUMENTS_PROJECT_ID && contextMenu.itemId === null) return;
    const projectId = contextMenu.projectId;
    const project = projects.find((project) => project.id === projectId);
    if (contextMenu.itemId === null) {
      setDeleteConfirm({ projectId, itemId: null, label: project?.title ?? t("folderFallback"), kind: "folder" });
      setContextMenu(null);
      return;
    }
    const item = project ? findTreeItem(project.items, contextMenu.itemId) : null;
    const isFolder = item ? !isFileItem(item) : false;
    setDeleteConfirm({
      projectId,
      itemId: contextMenu.itemId,
      documentId: item?.documentId,
      label: item?.label ?? t("itemFallback"),
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
    }, "delete");
  }

  function cancelDelete() {
    setDeleteConfirm(null);
  }

  // 우클릭한 행이 2개 이상 묶음 선택에 들어 있으면 메뉴를 묶음 메뉴로 바꾼다. 0이면 단일 항목 메뉴다.
  const selectedContextCount = contextMenu?.itemId && selectedItemIds.has(contextMenu.itemId) && selectedItemIds.size > 1
    ? selectedItemIds.size
    : 0;

  /** 묶음 삭제(우클릭 메뉴·Delete 키): 바로 지우지 않고 대상 이름과 개수를 보여 주는 확인 모달을 연다. */
  function deleteSelectedItems() {
    setContextMenu(null);
    const { items, skipped } = planBulkDelete(projects, selectedItemIds, isWorkspaceOwner);
    if (items.length === 0) {
      if (skipped.length > 0) publishNotice(bulkNotice("delete", 0, skipped));
      return;
    }
    setBulkDeleteConfirm({
      items: items.map((item) => ({ id: item.id, label: item.label, kind: isFileItem(item) ? "document" : "folder" })),
      skipped
    });
  }

  function confirmBulkDelete() {
    if (!bulkDeleteConfirm) return;
    const { items, skipped } = bulkDeleteConfirm;
    setBulkDeleteConfirm(null);
    setSelectedItemIds(new Set());
    void runTreeMutation(async (latest) => {
      const failures = [...skipped];
      let deletedCount = 0;
      for (const target of items) {
        const location = findItemLocation(latest, target.id);
        const project = location && latest.find((entry) => entry.id === location.projectId);
        const item = project ? findTreeItem(project.items, target.id) : null;
        // 기다리는 동안 이미 사라졌으면(앞서 지운 폴더의 하위 등) 삭제 목적은 이뤄졌다.
        if (!location || !item) {
          deletedCount += 1;
          continue;
        }
        const deleted = collectDeletedTreeIds(latest, location.projectId, target.id);
        try {
          if (target.kind === "folder") await deleteFolder(target.id);
          else if (item.documentId) await deleteDocument(item.documentId);
          else throw new Error(t("uploadPending"));
          deletedCount += 1;
          onDeletedRef.current?.(deleted);
        } catch (error) {
          failures.push({ label: target.label, reason: getErrorMessage(error, t("deleteItemFailed"), tShared) });
        }
      }
      publishNotice(bulkNotice("delete", deletedCount, failures));
    }, "delete");
  }

  function cancelBulkDelete() {
    setBulkDeleteConfirm(null);
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
      publishNotice({ kind: "failed", notificationKey: "renameFailed", title: t("failed.rename"), message: t("duplicateInFolder") });
      return;
    }
    void runTreeMutation(async (latest) => {
      const exists = itemId ? hasTreeItem(latest, itemId) : latest.some((entry) => entry.id === projectId);
      if (!exists) throw new Error(t("staleTarget"));
      // 기다리는 동안 같은 폴더에 같은 이름이 생겼을 수 있어 실행 시점에 다시 확인한다.
      if (isDuplicateName(latest)) throw new Error(t("duplicateInFolder"));
      if (item?.documentId) await renameDocument(item.documentId, nextLabel);
      else if (projectId !== ROOT_DOCUMENTS_PROJECT_ID || itemId) await renameFolder(itemId ?? projectId, nextLabel);
    }, "rename");
  }

  function cancelEditing() {
    editingCancelRef.current = true;
    setEditing(null);
  }

  async function renameDocumentById(documentId: string, nextLabel: string) {
    try { await renameDocument(documentId, nextLabel); }
    finally { await refreshRef.current().catch(() => {}); }
  }

  /** 권한을 모르면 false다(막지 않고 서버가 판단한다). */
  function itemMoveDeniedReason(itemId: string) {
    return moveDeniedReason(projects, itemId, isWorkspaceOwner);
  }

  /** 꺼낼 권한이 없으면 끌기를 시작하지 않고 이유를 알린다. 묶음은 옮길 때 항목별로 건너뛰고 알린다. */
  function canStartDrag(itemId: string) {
    if (selectedItemIds.has(itemId) && selectedItemIds.size > 1) return true;
    const reason = itemMoveDeniedReason(itemId);
    if (!reason) return true;
    publishNotice({ kind: "failed", notificationKey: "moveFailed", title: t("failed.move"), message: reasonText(reason) });
    return false;
  }

  function isDropDenied(target: DropTarget) {
    return draggedItem !== null && isDropDeniedByFolder(projects, target, isWorkspaceOwner);
  }

  /** 권한을 모르면 false다(막지 않고 서버가 판단한다). */
  function isFolderWriteDenied(folderId: string) {
    return canWriteTreeFolder(projects.flatMap((project) => project.items), folderId, isWorkspaceOwner) === false;
  }

  function onDragDenied(itemId: string | null) {
    setDropDeniedItemId(itemId);
    if (itemId !== null) {
      setDropTarget(null);
      setFileDropTarget(null);
    }
  }

  function onDragStart(projectId: string, itemId: string) {
    setDraggedItem({ projectId, itemId });
    setContextMenu(null);
    // 선택 밖의 항목을 끌면 선택은 의미가 없으므로 해제한다.
    if (!selectedItemIds.has(itemId)) setSelectedItemIds(new Set());
  }

  function onDragOverItem(target: DropTarget) {
    setDropDeniedItemId(null);
    if (draggedItem) setDropTarget(target);
  }

  function onFileDragOver(target: FileDropTarget) {
    setDropDeniedItemId(null);
    setFileDropTarget(target);
  }

  function onFileDragLeave() {
    setFileDropTarget(null);
  }

  function onDragEnd() {
    setDraggedItem(null);
    setDropTarget(null);
    setFileDropTarget(null);
    setDropDeniedItemId(null);
  }

  function onEditingChange(label: string) {
    setEditing((current) => current ? { ...current, label } : current);
  }

  return {
    projects,
    setProjects,
    draggedItem,
    dropTarget,
    dropDeniedItemId,
    canStartDrag,
    isDropDenied,
    isFolderWriteDenied,
    itemMoveDeniedReason,
    onDragDenied,
    onFileDragOver,
    fileDropTarget,
    contextMenu,
    closeContextMenu,
    editing,
    deleteConfirm,
    mergeConfirm,
    confirmMerge,
    cancelMerge,
    selectedItemIds,
    toggleSelectedItem,
    selectItemRange,
    clearSelectedItems,
    selectedContextCount,
    deleteSelectedItems,
    bulkDeleteConfirm,
    confirmBulkDelete,
    cancelBulkDelete,
    setFileDropTarget,
    addProject,
    moveTreeEntry,
    moveTarget,
    openMoveContextTarget,
    openMoveSelectedItems,
    confirmMoveTo,
    closeMoveDialog: () => setMoveTarget(null),
    openFolderMenu,
    openFolderMenuAt,
    openProjectMenu,
    renameContextTarget,
    takeFolderTargetFromContext,
    openPermissionContextTarget,
    permissionTarget,
    closePermissionDialog: () => setPermissionTarget(null),
    applyPermission,
    convertContextTarget,
    convertContextTargetToMarkdown,
    convertConfirm,
    confirmConvert,
    cancelConvert: () => setConvertConfirm(null),
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
