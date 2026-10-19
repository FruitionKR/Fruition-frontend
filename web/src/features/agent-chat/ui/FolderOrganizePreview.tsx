"use client";

import Image from "next/image";
import { useState } from "react";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import lightningIcon from "@/shared/assets/svg/agent/organize-lightning.svg";
import dividerIcon from "@/shared/assets/svg/agent/organize-divider.svg";
import warningIcon from "@/shared/assets/svg/agent/organize-warning-circle.svg";
import tooltipArrowIcon from "@/shared/assets/svg/agent/organize-tooltip-arrow.svg";
import checkOnIcon from "@/shared/assets/svg/agent/organize-check-on.svg";
import checkOffIcon from "@/shared/assets/svg/agent/organize-check-off.svg";
import sortIcon from "@/shared/assets/svg/agent/organize-sort.svg";
import arrowIcon from "@/shared/assets/svg/agent/organize-arrow.svg";
import cancelIcon from "@/shared/assets/svg/agent/organize-cancel.svg";
import applyIcon from "@/shared/assets/svg/agent/organize-apply.svg";
import noticeTailIcon from "@/shared/assets/svg/agent/organize-notice-tail.svg";
import { agentPlanStatusLabel, canApproveAgentPlan } from "../lib/agentPlan";
import {
  buildFolderOrganizeView,
  canApplyFolderOrganizeSelection,
  folderOrganizeNotice,
  parseSkillCommand,
  type FolderOrganizeRequest,
  type FolderOrganizeRow
} from "../lib/folderOrganize";
import { useAgentPlanRun } from "../model/useAgentPlanRun";
import styles from "./FolderOrganize.module.css";

type SortOrder = "plan" | "asc" | "desc";
const NEXT_SORT: Record<SortOrder, SortOrder> = { plan: "asc", asc: "desc", desc: "plan" };

function sortRows(rows: FolderOrganizeRow[], order: SortOrder): FolderOrganizeRow[] {
  if (order === "plan") return rows;
  const sorted = [...rows].sort((a, b) => a.originalName.localeCompare(b.originalName, "ko"));
  return order === "asc" ? sorted : sorted.reverse();
}

function CheckBox({ checked, label, disabled, onToggle }: { checked: boolean; label: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={styles.check} disabled={disabled} onClick={onToggle}>
      <Image src={checked ? checkOnIcon : checkOffIcon} alt="" />
    </button>
  );
}

/**
 * 폴더 정리 스킬 결과 미리보기 (Figma 1656:11542). 문서 편집 스킬은 채팅의 편집 미리보기를 그대로 쓰고,
 * 폴더·문서를 옮기거나 이름을 바꾸는 계획(action "folder_organize")만 메인 영역에 이 표로 보여 준다.
 */
export function FolderOrganizePreview({ request, onClose }: { request: FolderOrganizeRequest; onClose: () => void }) {
  const { run, plan, tree, mutation, error, busy, ready, hasQueryError, clarificationMessage, retry } = useAgentPlanRun(request.turnId);
  const view = plan ? buildFolderOrganizeView(plan, tree ?? []) : null;
  const rows = view?.rows ?? [];
  const { command, rule } = parseSkillCommand(request.question);
  const [deselectedIds, setDeselectedIds] = useState<ReadonlySet<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>("plan");
  const selectedCount = rows.filter((row) => !deselectedIds.has(row.id)).length;
  const isAllSelected = rows.length > 0 && selectedCount === rows.length;
  const isAwaiting = canApproveAgentPlan(run);
  const canApply = ready && canApplyFolderOrganizeSelection(rows.length, selectedCount);
  const description = rule ? `규칙: ${rule}` : plan?.summary.normalize("NFC") ?? "";

  function toggleRow(id: string) {
    setDeselectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className={styles.preview} aria-label="폴더 정리 미리보기">
      <header className={styles.hero}>
        <div className={styles["title-row"]}>
          <h1 className={styles.title}>{view?.targetFolderName ?? "폴더 정리"}</h1>
          <div className={styles.badge}>
            {isAwaiting && <>
              <Image src={warningIcon} alt="" />
              <span className={styles["badge-arrow"]} aria-hidden="true"><Image src={tooltipArrowIcon} alt="" /></span>
            </>}
            <span className={styles["badge-label"]} role="status">
              {isAwaiting ? "미리보기" : !run && error ? "계획 조회 실패" : agentPlanStatusLabel(run?.status)}
            </span>
          </div>
        </div>
        <div className={styles.description}>
          <span className={styles.command}>
            <Image src={lightningIcon} alt="" />
            문서 : {command ?? "폴더 정리"}
          </span>
          {description && <>
            <Image src={dividerIcon} alt="" className={styles.divider} />
            <p className={styles.rule}>{description}</p>
          </>}
        </div>
      </header>

      <div className={styles.body}>
        {plan && (
          <div className={styles.table} role="table" aria-label="정리할 항목">
            <div className={cx(styles.row, styles["is-head"])} role="row">
              <div className={styles.source} role="columnheader">
                <CheckBox
                  checked={isAllSelected}
                  label="모두 선택"
                  disabled={!isAwaiting || rows.length === 0}
                  onToggle={() => setDeselectedIds(isAllSelected ? new Set(rows.map((row) => row.id)) : new Set())}
                />
                <button type="button" className={styles.sort} aria-label={`커맨드 정렬: ${{ plan: "계획 순서", asc: "이름 오름차순", desc: "이름 내림차순" }[sortOrder]}`} onClick={() => setSortOrder(NEXT_SORT[sortOrder])}>
                  커맨드
                  <Image src={sortIcon} alt="" />
                </button>
              </div>
              <span className={styles.arrow} aria-hidden="true"><Image src={arrowIcon} alt="" /></span>
              <div className={styles.destination} role="columnheader">바뀔 위치 · 이름</div>
              <div className={styles.change} role="columnheader">변경</div>
            </div>
            {sortRows(rows, sortOrder).map((row) => {
              const checked = !deselectedIds.has(row.id);
              return (
                <div key={row.id} className={styles.row} role="row">
                  <div className={styles.source} role="cell">
                    <CheckBox checked={checked} label={`${row.originalName || row.newName} 선택`} disabled={!isAwaiting} onToggle={() => toggleRow(row.id)} />
                    <span className={styles["source-name"]} title={row.originalName}>{row.originalName || "새 문서"}</span>
                  </div>
                  <span className={styles.arrow} aria-hidden="true"><Image src={arrowIcon} alt="" /></span>
                  <div className={styles.destination} role="cell">
                    <p className={styles.path} title={`${row.folderName} / ${row.newName}`}>
                      <span className={styles.folder}>{row.folderName}</span>
                      <span className={styles.folder}>/</span>
                      <span className={styles["new-name"]}>{row.newName}</span>
                    </p>
                    {row.reason && <p className={styles.reason}>→ {row.reason}</p>}
                  </div>
                  <div className={styles.change} role="cell">
                    <span className={styles.chip}>{row.changeLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.notice}>
          <Image src={noticeTailIcon} alt="" className={styles["notice-tail"]} />
          <p className={styles["notice-text"]}>
            {plan && isAwaiting
              ? folderOrganizeNotice(rows.length, selectedCount, view?.createdFolders ?? [])
              : clarificationMessage ?? agentPlanStatusLabel(run?.status)}
          </p>
          {isAwaiting && !canApplyFolderOrganizeSelection(rows.length, selectedCount) && (
            <p className={styles["notice-hint"]}>일부 항목만 적용하는 기능은 아직 지원하지 않아요. 모두 선택해야 적용할 수 있어요.</p>
          )}
          {run && ["failed", "partial_failed", "conflicted", "rollback_failed"].includes(run.status) && (
            <p className={styles["notice-error"]} role="alert">작업을 완료하지 못했습니다. 작업 로그에서 항목별 상태를 확인해주세요.</p>
          )}
          {error && <p className={styles["notice-error"]} role="alert">{typeof error === "string" ? error : getErrorMessage(error, "계획을 불러오지 못했습니다.")}</p>}
          <div className={styles.actions}>
            {error && <button type="button" className={cx(styles.action, styles["is-primary"])} disabled={busy} onClick={retry}>다시 확인</button>}
            {isAwaiting ? <>
              <button
                type="button"
                className={cx(styles.action, styles["is-cancel"])}
                disabled={busy || hasQueryError}
                onClick={() => mutation.mutate("reject", { onSuccess: onClose })}
              >
                <Image src={cancelIcon} alt="" />
                취소
              </button>
              <button
                type="button"
                className={cx(styles.action, styles["is-primary"])}
                disabled={!canApply || busy}
                onClick={() => mutation.mutate("approve")}
              >
                <Image src={applyIcon} alt="" />
                {mutation.isPending ? "처리 중" : `선택한 ${selectedCount}개 적용`}
              </button>
            </> : (
              <button type="button" className={cx(styles.action, styles["is-primary"])} onClick={onClose}>
                <Image src={applyIcon} alt="" />
                닫기
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
