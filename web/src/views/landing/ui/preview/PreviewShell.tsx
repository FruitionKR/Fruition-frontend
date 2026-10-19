import { cx } from "@/shared/lib/classNames";
import {
  SidebarChevronIcon,
  SidebarPlusIcon,
  SidebarSearchIcon
} from "@/widgets/document-sidebar/ui/SidebarIcons";
import styles from "./PreviewShell.module.css";

/*
 * 문서 사이드바 조각(통합 검색 · 문서/그래프 전환 · 파일 트리). Figma 1571:27625 SNB와 실제 서비스 화면을 따른다.
 */

export interface TreeRow {
  readonly label: string;
  readonly depth: 0 | 1 | 2;
  readonly kind: "folder" | "open-folder" | "file";
  readonly badge?: string;
  readonly isActive?: boolean;
  /** 올리는 중·변환 중인 행 (실제 사이드바의 진행 표시) */
  readonly status?: string;
}

function TreeIcon({ row }: { row: TreeRow }) {
  if (row.status) return <span className={cx(styles["tree-slot"], styles["tree-spinner"])} />;
  if (row.kind === "file") return <span className={styles["tree-slot"]} />;
  return (
    <span className={styles["tree-slot"]}>
      <SidebarChevronIcon className={cx(styles["tree-arrow"], row.kind === "open-folder" && styles["is-open"])} />
    </span>
  );
}

export function SidebarPanel({ rows }: { rows: readonly TreeRow[] }) {
  return (
    <div className={styles["sidebar-panel"]}>
      <p className={styles["search"]}>
        <SidebarSearchIcon />
        통합 검색
      </p>
      <div className={styles["segment"]}>
        <span className={styles["is-active"]}>문서</span>
        <span>그래프</span>
      </div>
      <p className={styles["sidebar-index"]}>FILE</p>
      <ul className={styles["tree"]}>
        {rows.map((row) => (
          <li
            key={row.label}
            className={cx(styles["tree-row"], row.isActive && styles["is-active"], row.status && styles["is-pending"])}
            data-depth={row.depth}
          >
            <TreeIcon row={row} />
            <span className={styles["tree-label"]}>{row.label}</span>
            {row.status ? <span className={styles["tree-status"]}>{row.status}</span> : null}
            {row.badge ? <span className={styles["tree-badge"]}>{row.badge}</span> : null}
          </li>
        ))}
      </ul>
      <p className={styles["tree-add"]}>
        <SidebarPlusIcon size={20} />새 노트 추가
      </p>
    </div>
  );
}
