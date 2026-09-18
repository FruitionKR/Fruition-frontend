import { cx } from "@/shared/lib/classNames";
import type { Project, TreeItem } from "@/entities/tree";
import { checkOnIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { fileDisplay } from "./TreeNode";
import {
  collectSelectableDocumentIds,
  isAllSelected
} from "../model/wikiIngestSelection";
import styles from "./DocumentSidebar.module.css";

// 선택 행 들여쓰기: Figma 기준 6px + depth당 18px (pl 24 / 42)
const INGEST_ROW_BASE_PADDING_PX = 6;
const INGEST_ROW_INDENT_PER_DEPTH_PX = 18;

/**
 * 위키 편입 선택 모드 트리 (Figma 1027:6233).
 * 문서 트리를 읽기 전용으로 펼쳐 놓고 행마다 체크박스를 붙인다.
 * 폴더를 체크하면 하위의 선택 가능한 문서를 한꺼번에 고른다.
 */
export function WikiIngestTree({
  projects,
  eligibleDocumentIds,
  selectedIds,
  onToggle
}: {
  projects: Project[];
  /** 위키 반영이 가능한 문서 id. 나머지는 체크박스를 비활성화한다. */
  eligibleDocumentIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onToggle: (documentIds: string[]) => void;
}) {
  return (
    <div className={styles["ingest-tree"]} role="group" aria-label="위키에 편입할 문서 선택">
      <div className={styles["ingest-title"]}>
        <span>자료 목록</span>
      </div>
      {projects.flatMap((project) => project.items).map((item) => (
        <IngestRow
          key={item.id}
          item={item}
          depth={0}
          eligibleDocumentIds={eligibleDocumentIds}
          selectedIds={selectedIds}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function IngestRow({
  item,
  depth,
  eligibleDocumentIds,
  selectedIds,
  onToggle
}: {
  item: TreeItem;
  depth: number;
  eligibleDocumentIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onToggle: (documentIds: string[]) => void;
}) {
  const isFolder = item.type !== "file";
  const targetIds = collectSelectableDocumentIds([item], eligibleDocumentIds);
  const isSelectable = targetIds.length > 0;
  const isChecked = isAllSelected(selectedIds, targetIds);
  const display = fileDisplay(item);

  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={isChecked}
        disabled={!isSelectable}
        className={cx(styles["ingest-row"], isFolder && styles["is-folder"])}
        style={{ paddingLeft: INGEST_ROW_BASE_PADDING_PX + depth * INGEST_ROW_INDENT_PER_DEPTH_PX }}
        title={isSelectable || isFolder ? undefined : "마크다운 문서만 위키에 편입할 수 있습니다."}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(targetIds);
        }}
      >
        <span className={cx(styles["ingest-check"], isChecked && styles["is-checked"])} aria-hidden>
          {isChecked && <SvgIcon src={checkOnIcon} />}
        </span>
        <span className={styles["ingest-label"]}>{display.name}</span>
        {display.badge && <small className={styles["tree-type-badge"]}>{display.badge}</small>}
      </button>
      {item.children?.map((child) => (
        <IngestRow
          key={child.id}
          item={child}
          depth={depth + 1}
          eligibleDocumentIds={eligibleDocumentIds}
          selectedIds={selectedIds}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}
