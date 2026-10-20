import { ROOT_DOCUMENTS_PROJECT_ID } from "@/entities/tree/lib/projectsFromServerTree";
import type { ContextMenuState } from "@/entities/tree";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useDismissOnOutside } from "@/shared/hooks/useDismissOnOutside";
import { nextMenuItemIndex } from "../model/menuKeyboard";
import styles from "./DocumentSidebar.module.css";

export function ContextMenu({
  contextMenu,
  canCreateProject,
  canCreateInTarget,
  convertTarget,
  canRenameTarget,
  canDeleteTarget = true,
  canSetPermissionTarget = false,
  selectedCount = 0,
  onDeleteSelected,
  onRenameContextTarget,
  onSetPermissionContextTarget,
  onAddProject,
  onAddMarkdownFromContext,
  onUploadFromContext,
  onConvertContextTarget,
  onDeleteContextTarget,
  onClose
}: {
  contextMenu: ContextMenuState;
  /** 새 폴더 생성은 뷰 정책(canCreateProjectFromView)을 따른다. */
  canCreateProject: boolean;
  /** 파일(노트·PDF) 메뉴면 false. 새 폴더·새 노트·파일 업로드를 숨긴다. */
  canCreateInTarget: boolean;
  /** PDF 원본 문서일 때만 값이 있고, 처리 중이거나 변환 권한이 없으면 isDisabled로 비활성화한다. 권한 때문이면 disabledReason을 툴팁으로 알린다. */
  convertTarget: { isDisabled: boolean; disabledReason?: string } | null;
  /** PDF 원본은 편집 불가 문서라 이름 변경 메뉴를 숨긴다. */
  canRenameTarget: boolean;
  /** 서버 can_delete=false(문서 소유자·OWNER가 아님)면 삭제 메뉴를 비활성화한다. */
  canDeleteTarget?: boolean;
  /** 문서·폴더 항목이면 공동 편집 권한 설정 메뉴를 보인다(권한 판정은 서버가 한다). */
  canSetPermissionTarget?: boolean;
  /** 우클릭한 행이 2개 이상 묶음 선택에 들어 있으면 그 개수. 단일 항목 메뉴 대신 묶음 메뉴를 보인다. */
  selectedCount?: number;
  onDeleteSelected?: () => void;
  onRenameContextTarget: () => void;
  onSetPermissionContextTarget?: () => void;
  onAddProject: () => void;
  onAddMarkdownFromContext: () => void;
  onUploadFromContext: () => void;
  onConvertContextTarget: () => void;
  onDeleteContextTarget: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // 편집기 등은 click 전파를 막으므로 click이 아닌 pointerdown으로 바깥 입력을 감지한다.
  // 폴더 + 버튼은 자체 onClick으로 같은 폴더면 닫고 다른 폴더면 메뉴를 옮기므로 바깥으로 보지 않는다.
  useDismissOnOutside(menuRef, true, onClose, isFolderMenuTrigger);

  // 열리면 첫 항목에 포커스를 둔다(body에 portal돼 Tab으로는 닿기 어렵다). 닫힐 때 포커스가 메뉴와 함께 사라졌으면
  // (Esc 등) 연 요소로 되돌린다. 항목이 다른 곳(이름 편집 칸 등)으로 포커스를 옮겼으면 건드리지 않는다.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    menuItems(menuRef.current)[0]?.focus();
    return () => {
      const active = document.activeElement;
      if ((active === null || active === document.body) && opener?.isConnected) opener.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems(menuRef.current);
    const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
    if (index === null) {
      // 메뉴 밖으로 Tab이 새면 portal 위치(body 끝)로 빠지므로 메뉴를 닫고 연 요소로 돌아간다.
      if (event.key === "Tab") {
        event.preventDefault();
        onClose();
      }
      return;
    }
    event.preventDefault();
    items[index]?.focus();
  }

  // 사이드바의 overflow와 스태킹 컨텍스트에 갇히지 않도록 viewport 좌표 그대로 body에 렌더한다.
  return createPortal(
    <div
      ref={menuRef}
      className={styles["folder-context-menu"]}
      style={{ left: contextMenu.x, top: contextMenu.y }}
      role="menu"
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      // 열린 메뉴 위 우클릭이 사이드바 빈 영역 핸들러로 버블돼 메뉴가 바뀌지 않도록 막는다.
      onContextMenu={(event) => event.preventDefault()}
    >
      {selectedCount > 1 && onDeleteSelected ? (
        <button type="button" role="menuitem" tabIndex={-1} className={styles.danger} onClick={onDeleteSelected}>
          선택한 {selectedCount}개 삭제
        </button>
      ) : (
      <>
      {canCreateInTarget && (
        <>
          {canCreateProject && (
            <button type="button" role="menuitem" tabIndex={-1} onClick={onAddProject}>새 폴더</button>
          )}
          <button type="button" role="menuitem" tabIndex={-1} onClick={onAddMarkdownFromContext}>새 노트</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={onUploadFromContext}>파일 업로드</button>
        </>
      )}
      {canRenameTarget && (
        <button type="button" role="menuitem" tabIndex={-1} onClick={onRenameContextTarget}>이름 변경</button>
      )}
      {canSetPermissionTarget && onSetPermissionContextTarget && (
        <button type="button" role="menuitem" tabIndex={-1} onClick={onSetPermissionContextTarget}>권한 설정</button>
      )}
      {convertTarget && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={convertTarget.isDisabled}
          title={convertTarget.disabledReason}
          aria-description={convertTarget.disabledReason}
          onClick={onConvertContextTarget}
        >
          Markdown으로 변환
        </button>
      )}
      {!(contextMenu.projectId === ROOT_DOCUMENTS_PROJECT_ID && contextMenu.itemId === null) && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={styles.danger}
          disabled={!canDeleteTarget}
          title={canDeleteTarget ? undefined : "문서 소유자와 워크스페이스 OWNER만 삭제할 수 있습니다."}
          onClick={onDeleteContextTarget}
        >
          삭제
        </button>
      )}
      </>
      )}
    </div>,
    document.body
  );
}

/** 고를 수 있는 메뉴 항목(비활성 항목은 건너뛴다). */
function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')] : [];
}

/** 폴더 행 + 버튼(TreeNode의 data-folder-menu-trigger)인지 확인한다. */
function isFolderMenuTrigger(target: Node): boolean {
  return target instanceof Element && target.closest("[data-folder-menu-trigger]") !== null;
}
