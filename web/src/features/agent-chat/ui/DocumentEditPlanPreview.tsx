import { useRef, useState } from "react";
import { cx } from "@/shared/lib/classNames";
import type { DocumentEditRow } from "../lib/documentEditPlan";
import { DIFF_LINE_PAGE, limitDiffHunks } from "../lib/documentEditPreviews";
import { PLAN_OPERATION_BLOCKED_NOTE } from "../lib/planAccess";
import { DocumentDiffLines } from "./DocumentDiffLines";
import styles from "./AgentChat.module.css";

function DocumentEditDiff({ row, isLoading }: { row: DocumentEditRow; isLoading: boolean }) {
  const [limit, setLimit] = useState(DIFF_LINE_PAGE);
  const regionRef = useRef<HTMLDivElement | null>(null);
  if (!row.hunks) return <p className={styles["edit-plan-note"]}>{isLoading ? "변경 내용을 불러오는 중이에요." : "변경 내용을 불러오지 못했어요."}</p>;
  const { hunks, hiddenLines } = limitDiffHunks(row.hunks, limit);
  if (hunks.length === 0) return <p className={styles["edit-plan-note"]}>보여 줄 변경 줄이 없어요.</p>;
  return <>
    <DocumentDiffLines
      regionRef={regionRef}
      label={`${row.title} 변경 내용`}
      groups={hunks.map((hunk, index) => ({ key: `${hunk.before_start}-${index}`, heading: `${hunk.before_start}행부터`, lines: hunk.lines }))}
    />
    {hiddenLines > 0 && (
      <button
        type="button"
        className={styles["edit-plan-more"]}
        onClick={() => {
          setLimit(limit + DIFF_LINE_PAGE);
          // 마지막으로 펼치면 버튼이 사라지므로 포커스를 내용으로 옮긴다.
          if (hiddenLines <= DIFF_LINE_PAGE) regionRef.current?.focus();
        }}
      >
        더 보기 ({hiddenLines}줄 남음)
      </button>
    )}
  </>;
}

/**
 * 문서 수정 계획(모든 작업이 apply_document_edit): 문서별 선택과 서버가 만든 변경 줄을 보여 준다.
 * 수락·거절과 선택 상태는 작업 카드(AgentPlanTaskDetail)가 가진다.
 */
export function DocumentEditPlanPreview({
  rows,
  deselectedIds,
  canSelect,
  isAwaiting,
  isLoadingPreviews,
  blockedOperationIds,
  onToggle
}: {
  rows: readonly DocumentEditRow[];
  deselectedIds: ReadonlySet<string>;
  canSelect: boolean;
  isAwaiting: boolean;
  isLoadingPreviews: boolean;
  blockedOperationIds: ReadonlySet<string> | undefined;
  onToggle: (rowId: string) => void;
}) {
  return (
    <ul className={styles["edit-plan-list"]} aria-label="수정할 문서">
      {rows.map((row, index) => {
        // 승인 뒤에는 서버 결과(고르지 않은 작업은 skipped·not_selected)로 선택 여부를 보여 준다.
        const isSelected = isAwaiting ? !deselectedIds.has(row.id) : !row.excluded;
        const isBlocked = row.operationIds.some((id) => blockedOperationIds?.has(id));
        return (
          <li key={row.id} className={cx(styles["edit-plan-item"], !isSelected && styles["is-excluded"])}>
            {/* 체크박스는 summary 밖에 둔다. 안에 두면 누를 때마다 펼침이 함께 바뀐다. */}
            <label className={styles["edit-plan-check"]}>
              <input type="checkbox" aria-label={`${row.title} 수정`} checked={isSelected} disabled={!canSelect} onChange={() => onToggle(row.id)} />
            </label>
            <details className={styles["edit-plan-doc"]} open={index === 0}>
              <summary>
                <span className={styles["edit-plan-head"]}>
                  <span className={styles["edit-plan-title"]}>{row.title}</span>
                  {row.hunks && (
                    <span className={styles["edit-plan-counts"]} aria-label={`${row.addedLines}줄 추가, ${row.removedLines}줄 삭제`}>
                      <span className={styles["is-added"]}>+{row.addedLines}</span>
                      <span className={styles["is-removed"]}>−{row.removedLines}</span>
                    </span>
                  )}
                </span>
                {row.summary && <span className={styles["edit-plan-summary"]}>{row.summary}</span>}
                {row.warning && <span className={cx(styles["edit-plan-note"], styles["is-warning"])}>{row.warning}</span>}
                {isAwaiting && isBlocked && <span className={styles["edit-plan-note"]}>{PLAN_OPERATION_BLOCKED_NOTE}</span>}
                {row.resultLabel && <span className={cx(styles["edit-plan-note"], styles["is-result"], row.isFailure && styles["is-failure"])}>{row.resultLabel}</span>}
              </summary>
              <div className={styles["edit-plan-body"]}>
                <DocumentEditDiff row={row} isLoading={isLoadingPreviews} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
