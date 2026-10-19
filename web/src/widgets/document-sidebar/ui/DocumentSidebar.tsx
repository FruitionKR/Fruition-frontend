import { useEffect, useState, type ChangeEvent as ReactChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { cx } from "@/shared/lib/classNames";
import type { ContextMenuState, DropTarget, EditingState, FileDropTarget, Project } from "@/entities/tree";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import { Tooltip } from "@/shared/ui/Tooltip";
import { RailDivider, RailGroup, RailNavigation, type RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import type { SettingsSection } from "@/widgets/workspace/lib/workspaceLocation";
import { ContextMenu } from "./ContextMenu";
import { GraphRailActions } from "./GraphRailActions";
import { GraphSidebarActions } from "./GraphSidebarActions";
import { RootTree } from "./RootTree";
import { SidebarProfile } from "./SidebarProfile";
import { SidebarWorkspaceHeader } from "./SidebarWorkspaceHeader";
import { sidebarToggleIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { SidebarPlusIcon, SidebarSearchIcon } from "./SidebarIcons";
import { WikiWorkButton } from "./WikiWorkButton";
import { DocumentSearch } from "@/features/document-search/ui/DocumentSearch";
import type { SelectableTreeItem, TreeInteractionProps } from "../model/treeInteraction";
import { canCreateProjectFromView, getBlankAreaContextProjectId } from "../model/sidebarMenu";
import { useFileDropZone } from "../model/useFileDropZone";
import styles from "./DocumentSidebar.module.css";

export function DocumentSidebar({
  projects,
  draggedItemId,
  selectedItemId,
  selectedItemIds,
  isPickingTarget = false,
  dropTarget,
  fileDropTarget,
  editing,
  openIds,
  onToggleOpen,
  onOpenMany,
  contextMenu,
  convertContextTarget,
  canRenameContextTarget,
  canDeleteContextTarget = true,
  canSetPermissionContextTarget = false,
  canCreateInContextTarget,
  uploadInputRef,
  activeView,
  documents,
  graphActions,
  onViewChange,
  onOpenSettings,
  settingsNav,
  isCollapsed = false,
  isOverlay = false,
  onCollapseSidebar,
  onExpandSidebar,
  onAddProject,
  resizeHandle,
  onUploadPickerChange,
  onMoveItem,
  onDropFiles,
  onDragStart,
  onToggleSelectItem,
  onClearSelectedItems,
  onDragOverItem,
  onFileDragOver,
  onFileDragLeave,
  onDragEnd,
  onContextMenuProject,
  onContextMenuItem,
  onOpenFolderMenuAt,
  onSelectGraphNode,
  onOpenInNewTab,
  onEditingChange,
  onCommitEditing,
  onCancelEditing,
  onRenameContextTarget,
  onSetPermissionContextTarget,
  onAddMarkdownFromContext,
  onCreateNote,
  onUploadFromContext,
  onConvertContextTarget,
  onDeleteContextTarget,
  onCloseContextMenu
}: {
  projects: Project[];
  draggedItemId: string | null;
  selectedItemId: string | null;
  selectedItemIds: ReadonlySet<string>;
  /** 스킬 실행 대상 고르기 중이면 행 클릭이 문서를 열지 않고 고른다 */
  isPickingTarget?: boolean;
  dropTarget: DropTarget | null;
  fileDropTarget: FileDropTarget | null;
  editing: EditingState | null;
  openIds: ReadonlySet<string>;
  onToggleOpen: (id: string) => void;
  onOpenMany: (ids: readonly string[]) => void;
  contextMenu: ContextMenuState | null;
  convertContextTarget: { isDisabled: boolean } | null;
  /** PDF 원본은 편집 불가 문서라 이름 변경 메뉴를 숨긴다. */
  canRenameContextTarget: boolean;
  /** 서버 can_delete=false면 삭제 메뉴를 비활성화한다. */
  canDeleteContextTarget?: boolean;
  /** 문서·폴더 항목 메뉴에 공동 편집 권한 설정을 보인다. */
  canSetPermissionContextTarget?: boolean;
  /** 파일 메뉴에서는 생성 항목(새 폴더·새 노트·파일 업로드)을 숨긴다. */
  canCreateInContextTarget: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  activeView: RailView;
  /** 워크스페이스 문서 목록. 헤더의 진행 중 작업 팝오버가 여기서 ingest 진행 문서를 고른다. */
  documents?: DocumentItemResponse[];
  /** 그래프 뷰 위키 편입·최신화. 트리는 사이드바, 버튼은 레일에 나눠 놓는다. */
  graphActions?: {
    documents: DocumentItemResponse[];
    projects: Project[];
    pending: "ingest" | "lint" | null;
    onIngestDocuments: (documents: DocumentItemResponse[]) => void;
    onLint: () => void;
  };
  /** 로그 뷰에서 문서 트리 대신 보여줄 최신순 작업 목록. */
  onViewChange: (view: RailView) => void;
  /** 레일 톱니·프로필에서 설정 화면의 항목을 연다 */
  onOpenSettings: (section: SettingsSection) => void;
  /** 설정 화면(Figma 1540:22452)에서 문서 트리 대신 보여줄 설정 메뉴 */
  settingsNav?: ReactNode;
  /**
   * 레일 "채팅 시작" 버튼은 새 시안(Figma 1527:16327)에 없어 뺐다. 채팅은 콘텐츠 우하단 플로팅 버튼으로 연다.
   * HomeWorkspace가 아직 넘기므로 타입만 남겨 둔다(사용하지 않음).
   */
  /** 레일만 남긴 접힌 상태 (Figma 1539:16566). 상단 바는 펼치기 버튼만, 문서 패널은 숨긴다(마운트는 유지). */
  isCollapsed?: boolean;
  /** 좁은 화면: 펼치면 콘텐츠를 밀지 않고 위에 겹친다. 폭은 고정이라 폭 조절 핸들을 두지 않는다. */
  isOverlay?: boolean;
  /** 상단 바 사이드바 접기 (Figma 1527:16284). 없으면 버튼을 비활성으로 둔다. */
  onCollapseSidebar?: () => void;
  /** 접힌 레일 맨 위 펼치기 (Figma 1540:17915) */
  onExpandSidebar?: () => void;
  onAddProject: () => void;
  /** 오른쪽 가장자리 폭 조절 핸들. 값은 화면에 보이는 폭(px)이다. */
  resizeHandle: {
    valueNow: number;
    valueMin: number;
    valueMax: number;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
  onUploadPickerChange: (event: ReactChangeEvent<HTMLInputElement>) => void;
  onMoveItem: (target: DropTarget) => void;
  onDropFiles: (projectId: string, folderId: string | null, files: File[]) => void;
  onDragStart: (projectId: string, itemId: string) => void;
  onToggleSelectItem: (itemId: string) => void;
  onClearSelectedItems: () => void;
  onDragOverItem: (target: DropTarget) => void;
  onFileDragOver: (target: FileDropTarget) => void;
  onFileDragLeave: () => void;
  onDragEnd: () => void;
  onContextMenuProject: (event: ReactMouseEvent<HTMLElement>, projectId: string) => void;
  onContextMenuItem: (event: ReactMouseEvent<HTMLButtonElement>, projectId: string, itemId: string) => void;
  onOpenFolderMenuAt: (projectId: string, itemId: string | null, anchor: HTMLElement) => void;
  onSelectGraphNode: (item: SelectableTreeItem) => void;
  onOpenInNewTab: (item: SelectableTreeItem) => void;
  onEditingChange: (label: string) => void;
  onCommitEditing: () => void;
  onCancelEditing: () => void;
  onRenameContextTarget: () => void;
  onSetPermissionContextTarget?: () => void;
  onAddMarkdownFromContext: () => void;
  /** 사이드바 맨 아래 "새 노트 추가": 최상위에 새 노트를 만들고 바로 연다 */
  onCreateNote: (projectId: string) => void;
  onUploadFromContext: () => void;
  onConvertContextTarget: () => void;
  onDeleteContextTarget: () => void;
  onCloseContextMenu: () => void;
}) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // 그래프 뷰 위키 편입 문서 선택 모드. 레일 버튼으로 켜고 사이드바 하단 바·Esc로 끈다.
  const [isIngestSelecting, setIsIngestSelecting] = useState(false);
  const isGraphSelecting = activeView === "graph" && isIngestSelecting;
  // 트리는 루트 프로젝트 하나뿐이다. 사이드바 전체가 루트 파일 드롭 영역이 된다.
  const rootProject = projects[0];
  const isSidebarFileDropTarget = Boolean(
    rootProject
    && fileDropTarget?.projectId === rootProject.id
    && fileDropTarget.folderId === null
  );
  const { handleDragOver, handleDragLeave, handleDrop } = useFileDropZone({
    projectId: rootProject?.id ?? "",
    folderId: null,
    onFileDragOver,
    onFileDragLeave,
    onDropFiles
  });
  // 트리 상호작용 상태·핸들러를 한 객체로 묶어 하위 트리로 전달한다.
  const interaction: TreeInteractionProps = {
    draggedItemId,
    selectedItemId,
    selectedItemIds,
    isPickingTarget,
    dropTarget,
    fileDropTarget,
    editing,
    openIds,
    onToggleOpen,
    onOpenMany,
    onMoveItem,
    onDropFiles,
    onDragStart,
    onToggleSelectItem,
    onClearSelectedItems,
    onDragOverItem,
    onFileDragOver,
    onFileDragLeave,
    onDragEnd,
    onContextMenuItem,
    onOpenFolderMenuAt,
    onSelectGraphNode,
    onOpenInNewTab,
    onEditingChange,
    onCommitEditing,
    onCancelEditing
  };

  // 그래프 밖으로 나가면(레일·노드 더블클릭 등 어떤 경로든) 문서 선택 모드를 끝낸다.
  useEffect(() => {
    if (activeView !== "graph") setIsIngestSelecting(false);
  }, [activeView]);

  // 홈·그래프 뷰가 함께 쓰는 문서 트리. 그래프 뷰는 위키 편입 선택 모드와 함께 감싼다.
  const projectTree = (
    <>
      {/* FILE 제목 (Figma 1540:17028). 홈 뷰에서는 hover·포커스 시 배경과 +(최상위 새 노트)가 나타난다. */}
      {rootProject && (
        <div className={cx(styles["tree-root-header"], activeView === "home" && styles["is-actionable"])}>
          <span>File</span>
          {activeView === "home" && (
            <button
              type="button"
              className={styles["tree-root-add"]}
              aria-label="새 노트 추가"
              onClick={(event) => {
                event.stopPropagation();
                onCreateNote(rootProject.id);
              }}
            >
              <SidebarPlusIcon size={16} />
            </button>
          )}
        </div>
      )}
      {rootProject && <RootTree project={rootProject} interaction={interaction} />}
      {/* 새 노트 추가 (Figma 1486:4480 자리): 최상위에 새 노트를 바로 만들고 연다.
          우클릭은 sidebar-content로 올라가 최상위 생성 메뉴(새 폴더·파일 업로드)를 연다. */}
      {activeView === "home" && rootProject && (
        <button
          type="button"
          className={styles["tree-add-page"]}
          onClick={(event) => {
            event.stopPropagation();
            onCreateNote(rootProject.id);
          }}
        >
          <SidebarPlusIcon size={20} />
          새 노트 추가
        </button>
      )}
      {contextMenu && (
        <ContextMenu
          contextMenu={contextMenu}
          canCreateProject={canCreateProjectFromView(activeView)}
          canCreateInTarget={canCreateInContextTarget}
          convertTarget={convertContextTarget}
          canRenameTarget={canRenameContextTarget}
          canDeleteTarget={canDeleteContextTarget}
          canSetPermissionTarget={canSetPermissionContextTarget}
          onRenameContextTarget={onRenameContextTarget}
          onSetPermissionContextTarget={onSetPermissionContextTarget}
          onAddProject={onAddProject}
          onAddMarkdownFromContext={onAddMarkdownFromContext}
          onUploadFromContext={onUploadFromContext}
          onConvertContextTarget={onConvertContextTarget}
          onDeleteContextTarget={onDeleteContextTarget}
          onClose={onCloseContextMenu}
        />
      )}
    </>
  );

  return (
    <>
    <aside
      className={cx(styles.sidebar, isCollapsed && styles["is-collapsed"], isOverlay && styles["is-overlay"], isSidebarFileDropTarget && styles["is-file-drop-target"])}
      onDragOver={rootProject ? handleDragOver : undefined}
      onDragLeave={rootProject ? handleDragLeave : undefined}
      onDrop={rootProject ? handleDrop : undefined}
    >
      {/* 상단 바 (Figma 1527:16276): 워크스페이스 전환 + 사이드바 접기. 레일·문서 패널 위를 가로지른다.
          접힌 상태(Figma 1540:17907)에서는 같은 45px 줄에 펼치기 버튼만 남는다. */}
      <div className={styles["sidebar-topbar"]}>
        {isCollapsed ? (
          <SidebarToggleButton label="사이드바 펼치기" onToggle={onExpandSidebar} />
        ) : (
          <>
            <SidebarWorkspaceHeader />
            <SidebarToggleButton label="사이드바 접기" onToggle={onCollapseSidebar} />
          </>
        )}
      </div>

      <div className={styles["sidebar-body"]}>
        <RailNavigation
          isCollapsed={isCollapsed}
          activeView={activeView}
          onViewChange={onViewChange}
          tools={(
            <>
              <RailGroup>
                <WikiWorkButton documents={documents} />
              </RailGroup>
              {activeView === "graph" && graphActions && (
                <>
                  <RailDivider />
                  <GraphRailActions
                    documents={graphActions.documents}
                    pending={graphActions.pending}
                    isSelecting={isGraphSelecting}
                    onToggleSelecting={() => {
                      // 문서 선택 트리는 문서 패널에 있어, 접힌 상태에서 선택을 시작하면 사이드바를 펼친다.
                      if (isCollapsed && !isIngestSelecting) onExpandSidebar?.();
                      setIsIngestSelecting((selecting) => !selecting);
                    }}
                    onLint={graphActions.onLint}
                  />
                </>
              )}
            </>
          )}
          footer={(
            <>
              <RailDivider />
              <SidebarProfile isActive={activeView === "settings"} onOpenSettings={onOpenSettings} />
            </>
          )}
        />

        <div className={styles["sidebar-panel"]}>
          <div className={styles["sidebar-top"]}>
            {/* 통합 검색 (Figma 1486:4398): 입력처럼 보이는 버튼으로 중앙 검색 모달을 연다. */}
            <button
              type="button"
              className={styles["sidebar-search"]}
              aria-haspopup="dialog"
              aria-expanded={isSearchOpen}
              onClick={(event) => {
                event.stopPropagation();
                setIsSearchOpen(true);
              }}
            >
              <SidebarSearchIcon className={styles["sidebar-search-icon"]} />
              <span>통합 검색</span>
            </button>
          </div>
          {isSearchOpen && (
            <DocumentSearch
              projects={projects}
              // 로그·스킬 등 문서 트리가 없는 화면에서 고르면 그 문서 URL로 이동해 홈 화면에서 연다.
              onSelectGraphNode={onSelectGraphNode}
              onClose={() => setIsSearchOpen(false)}
            />
          )}
          <input
            ref={uploadInputRef}
            className={styles["upload-picker"]}
            type="file"
            accept=".pdf,.md,application/pdf,text/markdown,text/plain"
            multiple
            onChange={onUploadPickerChange}
          />

          {settingsNav ?? (
          <div
            className={styles["sidebar-content"]}
            onContextMenu={(event) => {
              // 문서 관리 뷰에서는 트리 밖 빈 영역 우클릭도 프로젝트 메뉴(새 노트 등)를 연다.
              // 폴더·프로젝트에서 이미 연 메뉴(preventDefault됨)는 덮어쓰지 않는다.
              const projectId = getBlankAreaContextProjectId(activeView, event.defaultPrevented, projects);
              if (projectId === null) return;
              onContextMenuProject(event, projectId);
            }}
          >
            {activeView === "graph" && graphActions ? (
              <GraphSidebarActions
                documents={graphActions.documents}
                pending={graphActions.pending}
                projects={graphActions.projects}
                tree={projectTree}
                isSelecting={isGraphSelecting}
                onExitSelecting={() => setIsIngestSelecting(false)}
                onIngestDocuments={graphActions.onIngestDocuments}
              />
            ) : projectTree}
          </div>
          )}
        </div>
      </div>
    </aside>
      {/* 폭 조절 핸들: 최소 폭 미만으로 끌면 접히고, 접힌 레일 가장자리를 끌어 다시 펼친다. ←/→ 16px, Enter 접기/펼치기 */}
      {!isOverlay && (
      <div
        role="separator"
        tabIndex={0}
        className={styles["sidebar-resize-handle"]}
        aria-label="사이드바 폭 조절"
        aria-orientation="vertical"
        aria-valuenow={resizeHandle.valueNow}
        aria-valuemin={resizeHandle.valueMin}
        aria-valuemax={resizeHandle.valueMax}
        aria-valuetext={isCollapsed ? "접힘" : `${resizeHandle.valueNow}px`}
        onPointerDown={resizeHandle.onPointerDown}
        onKeyDown={resizeHandle.onKeyDown}
      />
      )}
    </>
  );
}

/** 상단 바 접기/펼치기 버튼 (Figma 1527:16284 / 1540:17915). 두 상태가 같은 아이콘을 쓴다. */
function SidebarToggleButton({ label, onToggle }: { label: string; onToggle?: () => void }) {
  return (
    <Tooltip content={label} placement="bottom" describe={false}>
      <button
        type="button"
        className={styles["sidebar-collapse"]}
        aria-label={label}
        disabled={!onToggle}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
      >
        <SvgIcon src={sidebarToggleIcon} className={styles["sidebar-collapse-icon"]} />
      </button>
    </Tooltip>
  );
}
