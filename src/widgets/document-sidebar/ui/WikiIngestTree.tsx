import { useState } from "react";
import { cx } from "@/shared/lib/classNames";
import type { Project, TreeItem } from "@/entities/tree";
import { arrowIcon, checkOnIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { fileDisplay } from "./TreeNode";
import {
  collectFolderMarkdownIds,
  getSelectionState,
  getTreeItemBlockReason,
  type IngestBlockReasons
} from "../model/wikiIngestSelection";
import styles from "./DocumentSidebar.module.css";

// 선택 행 들여쓰기: Figma 기준 6px + depth당 18px (pl 24 / 42)
const INGEST_ROW_BASE_PADDING_PX = 6;
const INGEST_ROW_INDENT_PER_DEPTH_PX = 18;

const NO_FOLDER_MARKDOWN_REASON = "이 폴더에는 선택할 수 있는 Markdown 문서가 없어요";

/**
 * 위키 편입 선택 모드 트리 (Figma 1027:6315).
 * 원래 폴더 구조(빈 폴더 포함)를 그대로 보여 주고 행마다 체크박스를 붙인다.
 * 편입할 수 없는 파일은 회색·비활성으로 두고 이유를 툴팁으로 알린다.
 * 폴더를 누르면 하위 폴더까지 선택 가능한 Markdown을 한꺼번에 고르고, 펼침/접힘은 화살표로 따로 한다.
 */
export function WikiIngestTree({
  projects,
  blockReasons,
  selectedIds,
  onToggle
}: {
  projects: Project[];
  /** 문서 id별 선택을 막는 이유(null이면 선택 가능). */
  blockReasons: IngestBlockReasons;
  selectedIds: ReadonlySet<string>;
  onToggle: (documentIds: string[]) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());

  function toggleOpen(itemId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

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
          blockReasons={blockReasons}
          selectedIds={selectedIds}
          collapsedIds={collapsedIds}
          onToggle={onToggle}
          onToggleOpen={toggleOpen}
        />
      ))}
    </div>
  );
}

function IngestRow({
  item,
  depth,
  blockReasons,
  selectedIds,
  collapsedIds,
  onToggle,
  onToggleOpen
}: {
  item: TreeItem;
  depth: number;
  blockReasons: IngestBlockReasons;
  selectedIds: ReadonlySet<string>;
  collapsedIds: ReadonlySet<string>;
  onToggle: (documentIds: string[]) => void;
  onToggleOpen: (itemId: string) => void;
}) {
  if (item.type === "wiki") return null;
  const isFolder = item.type === "folder";
  const isOpen = isFolder && !collapsedIds.has(item.id);
  const fileReason = getTreeItemBlockReason(item, blockReasons);
  const targetIds = isFolder
    ? collectFolderMarkdownIds(item.children ?? [], blockReasons)
    : fileReason === null && item.documentId ? [item.documentId] : [];
  const reason = isFolder ? (targetIds.length === 0 ? NO_FOLDER_MARKDOWN_REASON : null) : fileReason;
  const isDisabled = targetIds.length === 0;
  const state = getSelectionState(selectedIds, targetIds);
  const display = fileDisplay(item);

  return (
    <>
      <div
        className={cx(
          styles["ingest-row"],
          isFolder && styles["is-folder"],
          depth > 0 && styles["is-nested"],
          isDisabled && styles["is-disabled"]
        )}
        style={{ paddingLeft: INGEST_ROW_BASE_PADDING_PX + depth * INGEST_ROW_INDENT_PER_DEPTH_PX }}
        title={reason ?? undefined}
        onClick={(event) => {
          // 체크박스 버튼의 클릭도 여기로 올라온다. 행 어디를 눌러도 같은 토글이 된다.
          event.stopPropagation();
          if (!isDisabled) onToggle(targetIds);
        }}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={state === "mixed" ? "mixed" : state === "checked"}
          aria-label={item.label}
          aria-description={reason ?? undefined}
          disabled={isDisabled}
          className={cx(
            styles["ingest-check"],
            state === "checked" && styles["is-checked"],
            state === "mixed" && styles["is-mixed"]
          )}
        >
          {state === "checked" && <SvgIcon src={checkOnIcon} />}
        </button>
        {isFolder && (
          <button
            type="button"
            className={styles["ingest-folder-toggle"]}
            aria-expanded={isOpen}
            aria-label={`${display.name} ${isOpen ? "접기" : "펼치기"}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleOpen(item.id);
            }}
          >
            <SvgIcon src={arrowIcon} className={cx(styles["tree-arrow"], isOpen && styles["is-open"])} />
          </button>
        )}
        <span className={styles["ingest-label"]}>{display.name}</span>
        {display.badge && <small className={styles["tree-type-badge"]}>{display.badge}</small>}
      </div>
      {isOpen && item.children?.map((child) => (
        <IngestRow
          key={child.id}
          item={child}
          depth={depth + 1}
          blockReasons={blockReasons}
          selectedIds={selectedIds}
          collapsedIds={collapsedIds}
          onToggle={onToggle}
          onToggleOpen={onToggleOpen}
        />
      ))}
    </>
  );
}
