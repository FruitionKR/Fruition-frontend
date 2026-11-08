import type { TreeItem } from "@/entities/tree";
import { isFileItem } from "@/entities/tree";
import { cx } from "@/shared/lib/classNames";
import { SidebarChevronIcon } from "./SidebarIcons";
import styles from "./DocumentSidebar.module.css";

/** 업로드가 거절돼 서버 문서가 없는 자리표시 행인지. */
export function isUploadFailedItem(item: TreeItem): boolean {
  return isFileItem(item) && item.status === "failed" && !item.documentId;
}

export function TreeNodeIcon({
  item,
  isExpandable,
  isOpen,
  onExpandClick
}: {
  item: TreeItem;
  isExpandable: boolean;
  isOpen: boolean;
  /** 파일 행(변환본을 거느린 원본 PDF)의 화살표만 눌러 접고 편다. 행 클릭(문서 열기)으로 번지지 않게 막는다 */
  onExpandClick?: () => void;
}) {
  if (isFileItem(item) && onExpandClick && item.status !== "uploading") {
    return (
      <span
        className={cx(styles["tree-folder-slot"], styles["is-toggle"])}
        aria-hidden
        onClick={(event) => {
          event.stopPropagation();
          onExpandClick();
        }}
      >
        <SidebarChevronIcon className={cx(styles["tree-arrow"], isOpen && styles["is-open"])} />
      </span>
    );
  }
  if (isFileItem(item)) {
    if (item.status === "uploading") return <span className={styles["tree-upload-spinner"]} aria-hidden />;
    if (isUploadFailedItem(item)) {
      return (
        <span className={cx(styles["tree-folder-slot"], styles["tree-upload-failed-icon"])} aria-hidden>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M8 1.75 14.75 13.5H1.25L8 1.75Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8 6.25v3.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
          </svg>
        </span>
      );
    }
    return <span className={styles["tree-folder-slot"]} aria-hidden />;
  }
  return (
    <span className={styles["tree-folder-slot"]} aria-hidden>
      {isExpandable && <SidebarChevronIcon className={cx(styles["tree-arrow"], isOpen && styles["is-open"])} />}
    </span>
  );
}
