import { FOLDER_WRITE_FORBIDDEN_MESSAGE, type ContextMenuState } from "@/entities/tree";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/shared/lib/classNames";
import { useDismissOnOutside } from "@/shared/hooks/useDismissOnOutside";
import { nextMenuItemIndex } from "../model/menuKeyboard";
import { TREE_MENU_LABELS, type TreeMenuActionId } from "../model/treeItemActions";
import styles from "./DocumentSidebar.module.css";

export function ContextMenu({
  contextMenu,
  sections,
  blockedActions = NO_BLOCKED_ACTIONS,
  convertTarget,
  selectedCount = 0,
  focusNewNote = false,
  onDeleteSelected,
  onAction,
  onClose
}: {
  contextMenu: ContextMenuState;
  /** 보일 항목을 구역별로 나눈 목록(treeContextMenuSections). 구역 사이에 구분선을 그린다. */
  sections: TreeMenuActionId[][];
  /** 폴더 권한이 없어 비활성으로 둘 항목(treeMenuBlockedActions). 있으면 이유를 메뉴 안에 글자로 보여 준다. */
  blockedActions?: ReadonlySet<TreeMenuActionId>;
  /** PDF 원본의 Markdown 변환 상태. 처리 중이거나 변환 권한이 없으면 isDisabled로 비활성화하고, 권한 때문이면 disabledReason을 툴팁으로 알린다. */
  convertTarget: { isDisabled: boolean; disabledReason?: string } | null;
  /** 우클릭한 행이 2개 이상 묶음 선택에 들어 있으면 그 개수. 단일 항목 메뉴 대신 묶음 메뉴를 보인다. */
  selectedCount?: number;
  /** "새 노트 추가" 버튼으로 열었으면 새 노트에 포커스를 둔다. Enter 한 번으로 바로 만드는 지름길을 지킨다. */
  focusNewNote?: boolean;
  onDeleteSelected?: () => void;
  onAction: (action: TreeMenuActionId) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // 편집기 등은 click 전파를 막으므로 click이 아닌 pointerdown으로 바깥 입력을 감지한다.
  // 폴더 + 버튼은 자체 onClick으로 같은 폴더면 닫고 다른 폴더면 메뉴를 옮기므로 바깥으로 보지 않는다.
  useDismissOnOutside(menuRef, true, onClose, isFolderMenuTrigger);

  // 사이드바 맨 아래 버튼·화면 가장자리에서 열면 메뉴가 viewport 밖으로 잘리지 않게 안쪽으로 당긴다.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN_PX;
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN_PX;
    if (rect.top > maxTop) menu.style.top = `${Math.max(VIEWPORT_MARGIN_PX, maxTop)}px`;
    if (rect.left > maxLeft) menu.style.left = `${Math.max(VIEWPORT_MARGIN_PX, maxLeft)}px`;
  }, [contextMenu.x, contextMenu.y]);

  // 열리면 첫 항목에 포커스를 둔다(body에 portal돼 Tab으로는 닿기 어렵다). 닫힐 때 포커스가 메뉴와 함께 사라졌으면
  // (Esc 등) 연 요소로 되돌린다. 항목이 다른 곳(이름 편집 칸 등)으로 포커스를 옮겼으면 건드리지 않는다.
  // 연 요소는 첫 렌더에서 잡는다. effect에서 읽으면 개발 모드 StrictMode의 재실행 때 이미 메뉴 항목으로 옮긴 포커스를 잡는다.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  );
  useEffect(() => {
    const preferred = menuRef.current?.querySelector<HTMLButtonElement>("[data-menu-autofocus]");
    (preferred ?? menuItems(menuRef.current)[0])?.focus();
    return () => {
      const active = document.activeElement;
      if ((active === null || active === document.body) && opener?.isConnected) opener.focus();
    };
  }, [opener]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // 메뉴를 연 Enter를 누르고 있으면 키 반복이 포커스된 항목을 연달아 실행하지 않게 막는다.
    if (event.repeat && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      return;
    }
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
      ) : <>
      {sections.some((section) => section.some((action) => blockedActions.has(action))) && (
        <p className={styles["menu-blocked-reason"]} role="note">{FOLDER_WRITE_FORBIDDEN_MESSAGE}</p>
      )}
      {sections.map((section, index) => (
        <Fragment key={section.join()}>
          {/* 구분선은 menuitem이 아니라 방향키 이동에서 건너뛴다. */}
          {index > 0 && <div role="separator" className={styles["menu-separator"]} />}
          {section.map((action) => action === "convert" && convertTarget ? (
            <button
              key={action}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={convertTarget.isDisabled}
              title={convertTarget.disabledReason}
              aria-description={convertTarget.disabledReason}
              onClick={() => onAction(action)}
            >
              {TREE_MENU_LABELS[action]}
            </button>
          ) : (
            <button
              key={action}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={blockedActions.has(action)}
              aria-description={blockedActions.has(action) ? FOLDER_WRITE_FORBIDDEN_MESSAGE : undefined}
              className={cx(action === "delete" && styles.danger)}
              data-menu-autofocus={(action === "new-note" && focusNewNote) || undefined}
              onClick={() => onAction(action)}
            >
              {TREE_MENU_LABELS[action]}
            </button>
          ))}
        </Fragment>
      ))}
      </>}
    </div>,
    document.body
  );
}

const NO_BLOCKED_ACTIONS: ReadonlySet<TreeMenuActionId> = new Set();

/** 메뉴를 viewport 안으로 당길 때 가장자리와 두는 여백 (px) */
const VIEWPORT_MARGIN_PX = 8;

/** 고를 수 있는 메뉴 항목(비활성 항목은 건너뛴다). */
function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')] : [];
}

/** 메뉴를 토글하는 버튼(행 ⋯ 버튼·새 노트 추가, data-folder-menu-trigger)인지 확인한다. */
function isFolderMenuTrigger(target: Node): boolean {
  return target instanceof Element && target.closest("[data-folder-menu-trigger]") !== null;
}
