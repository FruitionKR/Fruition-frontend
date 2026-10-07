import { ROOT_DOCUMENTS_PROJECT_ID } from "@/entities/tree/lib/serverTree";
import type { ContextMenuState } from "@/entities/tree";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDismissOnOutside } from "@/shared/lib/useDismissOnOutside";
import styles from "./DocumentSidebar.module.css";

export function ContextMenu({
  contextMenu,
  canCreateProject,
  canCreateInTarget,
  convertTarget,
  canRenameTarget,
  onRenameContextTarget,
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
  /** PDF 원본 문서일 때만 값이 있고, 처리 중이면 isDisabled로 비활성화한다. */
  convertTarget: { isDisabled: boolean } | null;
  /** PDF 원본은 편집 불가 문서라 이름 변경 메뉴를 숨긴다. */
  canRenameTarget: boolean;
  onRenameContextTarget: () => void;
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

  // 사이드바의 overflow와 스태킹 컨텍스트에 갇히지 않도록 viewport 좌표 그대로 body에 렌더한다.
  return createPortal(
    <div
      ref={menuRef}
      className={styles["folder-context-menu"]}
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(event) => event.stopPropagation()}
      // 열린 메뉴 위 우클릭이 사이드바 빈 영역 핸들러로 버블돼 메뉴가 바뀌지 않도록 막는다.
      onContextMenu={(event) => event.preventDefault()}
    >
      {canCreateInTarget && (
        <>
          {canCreateProject && (
            <button type="button" onClick={onAddProject}>새 폴더</button>
          )}
          <button type="button" onClick={onAddMarkdownFromContext}>새 노트</button>
          <button type="button" onClick={onUploadFromContext}>파일 업로드</button>
        </>
      )}
      {canRenameTarget && (
        <button type="button" onClick={onRenameContextTarget}>이름 변경</button>
      )}
      {convertTarget && (
        <button type="button" disabled={convertTarget.isDisabled} onClick={onConvertContextTarget}>
          Markdown으로 변환
        </button>
      )}
      {!(contextMenu.projectId === ROOT_DOCUMENTS_PROJECT_ID && contextMenu.itemId === null) && (
        <button type="button" className={styles.danger} onClick={onDeleteContextTarget}>삭제</button>
      )}
    </div>,
    document.body
  );
}

/** 폴더 행 + 버튼(TreeNode의 data-folder-menu-trigger)인지 확인한다. */
function isFolderMenuTrigger(target: Node): boolean {
  return target instanceof Element && target.closest("[data-folder-menu-trigger]") !== null;
}
