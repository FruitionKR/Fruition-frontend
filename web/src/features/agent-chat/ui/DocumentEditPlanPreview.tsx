import { useRef, useState } from "react";
import { cx } from "@/shared/lib/classNames";
import { missingDiffNote, type DocumentEditRow } from "../lib/documentEditPlan";
import { DIFF_LINE_PAGE, limitDiffHunks } from "../lib/documentEditPreviews";
import { DocumentDiffLines } from "./DocumentDiffLines";
import styles from "./AgentChat.module.css";
import { useTranslations } from "next-intl";

function DocumentEditDiff({ row, missingNote }: { row: DocumentEditRow; missingNote: string }) {
  const t = useTranslations("agentChat");
  const [limit, setLimit] = useState(DIFF_LINE_PAGE);
  const regionRef = useRef<HTMLDivElement | null>(null);
  if (!row.hunks) return <p className={styles["edit-plan-note"]}>{missingNote}</p>;
  const { hunks, hiddenLines } = limitDiffHunks(row.hunks, limit);
  if (hunks.length === 0) return <p className={styles["edit-plan-note"]}>{t("editPlan.diff.noLines")}</p>;
  return <>
    <DocumentDiffLines
      regionRef={regionRef}
      label={t("editPlan.diff.label", { title: row.title })}
      groups={hunks.map((hunk, index) => ({ key: `${hunk.before_start}-${index}`, heading: t("editPlan.diff.fromLine", { line: hunk.before_start }), lines: hunk.lines }))}
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
        {t("editPlan.diff.more", { count: hiddenLines })}
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
  isPreviewExpired,
  blockedOperationIds,
  blockedRowIds,
  onToggle
}: {
  rows: readonly DocumentEditRow[];
  deselectedIds: ReadonlySet<string>;
  canSelect: boolean;
  isAwaiting: boolean;
  isLoadingPreviews: boolean;
  isPreviewExpired: boolean;
  blockedOperationIds: ReadonlySet<string>;
  /** 작업이 모두 막혀 고를 수 없는 문서 줄 */
  blockedRowIds: ReadonlySet<string>;
  onToggle: (rowId: string) => void;
}) {
  const t = useTranslations("agentChat");
  const missingNote = missingDiffNote({ isLoading: isLoadingPreviews, isAwaiting, isExpired: isPreviewExpired }, t);
  return (
    <ul className={styles["edit-plan-list"]} aria-label={t("editPlan.listLabel")}>
      {rows.map((row, index) => {
        // 승인 뒤에는 서버 결과(고르지 않은 작업은 skipped·not_selected)로 선택 여부를 보여 준다.
        const isBlocked = blockedRowIds.has(row.id);
        const isPartlyBlocked = !isBlocked && row.operationIds.some((id) => blockedOperationIds.has(id));
        const isSelected = isAwaiting ? !row.isPurged && !isBlocked && !deselectedIds.has(row.id) : !row.excluded;
        return (
          <li key={row.id} className={cx(styles["edit-plan-item"], !isSelected && styles["is-excluded"])}>
            {/* 체크박스는 summary 밖에 둔다. 안에 두면 누를 때마다 펼침이 함께 바뀐다. */}
            <label className={styles["edit-plan-check"]}>
              <input type="checkbox" aria-label={t("editPlan.rowCheckbox", { title: row.title })} checked={isSelected} disabled={!canSelect || row.isPurged || isBlocked} onChange={() => onToggle(row.id)} />
            </label>
            <details className={styles["edit-plan-doc"]} open={index === 0}>
              <summary>
                <span className={styles["edit-plan-head"]}>
                  <span className={styles["edit-plan-title"]}>{row.title}</span>
                  {row.hunks && (
                    <span className={styles["edit-plan-counts"]} aria-label={t("editPlan.lineCounts", { added: row.addedLines, removed: row.removedLines })}>
                      <span className={styles["is-added"]}>+{row.addedLines}</span>
                      <span className={styles["is-removed"]}>−{row.removedLines}</span>
                    </span>
                  )}
                </span>
                {row.summary && <span className={styles["edit-plan-summary"]}>{row.summary}</span>}
                {row.warning && <span className={cx(styles["edit-plan-note"], styles["is-warning"])}>{row.warning}</span>}
                {isAwaiting && isBlocked && <span className={styles["edit-plan-note"]}>{t("plan.access.operationBlocked")}</span>}
                {isAwaiting && isPartlyBlocked && <span className={styles["edit-plan-note"]}>{t("plan.access.rowPartlyBlocked")}</span>}
                {row.resultLabel && <span className={cx(styles["edit-plan-note"], styles["is-result"], row.isFailure && styles["is-failure"])}>{row.resultLabel}</span>}
              </summary>
              <div className={styles["edit-plan-body"]}>
                <DocumentEditDiff row={row} missingNote={row.isPurged ? t("editPlan.purgedDiff") : missingNote} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
