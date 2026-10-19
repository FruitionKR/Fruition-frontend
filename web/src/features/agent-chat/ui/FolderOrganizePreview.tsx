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
  folderOrganizeSelection,
  initialDeselectedRowIds,
  MAX_SELECTED_OPERATIONS,
  parseSkillCommand,
  selectedCreatedFolders,
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
  const view = plan ? buildFolderOrganizeView(plan, tree ?? [], run?.target_folder_id) : null;
  const rows = view?.rows ?? [];
  const { command, rule } = parseSkillCommand(request.question);
  // 사용자가 바꾼 선택. 계획(id·version)이 바뀌면 다시 AI가 권장한 기본 선택(suggested_selected)에서 시작한다.
  const planKey = plan ? `${plan.id}:${plan.version}` : null;
  const [userDeselection, setUserDeselection] = useState<{ planKey: string; ids: ReadonlySet<string> } | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("plan");
  const deselectedIds = userDeselection && userDeselection.planKey === planKey ? userDeselection.ids : initialDeselectedRowIds(rows);
  const selectedRows = rows.filter((row) => !deselectedIds.has(row.id));
  const selectedCount = selectedRows.length;
  const isAllSelected = rows.length > 0 && selectedCount === rows.length;
  const isAwaiting = canApproveAgentPlan(run);
  const operationIds = plan ? folderOrganizeSelection(plan, rows, new Set(selectedRows.map((row) => row.id))) : null;
  const isSelectionValid = canApplyFolderOrganizeSelection(selectedCount, operationIds);
  const canApply = ready && isSelectionValid;
  const duplicateDeselected = rows.filter((row) => row.duplicateWarning && deselectedIds.has(row.id)).length;
  const ruleText = run?.rule_summary?.trim().normalize("NFC") || rule;
  const description = ruleText ? `규칙: ${ruleText}` : plan?.summary.normalize("NFC") ?? "";

  function setDeselected(ids: ReadonlySet<string>) {
    if (planKey) setUserDeselection({ planKey, ids });
  }

  function toggleRow(id: string) {
    const next = new Set(deselectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDeselected(next);
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
                  onToggle={() => setDeselected(isAllSelected ? new Set(rows.map((row) => row.id)) : new Set())}
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
              // 승인 뒤에는 서버 결과(고르지 않은 작업은 skipped·not_selected)로 선택 여부를 보여 준다.
              const checked = isAwaiting ? !deselectedIds.has(row.id) : !row.excluded;
              return (
                <div key={row.id} className={cx(styles.row, row.duplicateWarning && styles["is-duplicate"], !isAwaiting && row.excluded && styles["is-excluded"])} role="row">
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
                    {row.duplicateWarning
                      ? <p className={cx(styles.reason, styles["is-warning"])} title={row.duplicateWarning}>→ {row.duplicateWarning}</p>
                      : row.reason && <p className={styles.reason} title={row.reason}>→ {row.reason}</p>}
                    {row.dependencyNote && <p className={styles["reason-note"]} title={row.dependencyNote}>{row.dependencyNote}</p>}
                  </div>
                  <div className={styles.change} role="cell">
                    <span className={styles.chip}>{!isAwaiting && row.excluded ? "제외됨" : row.changeLabel}</span>
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
              ? folderOrganizeNotice(rows.length, selectedCount, selectedCreatedFolders(view?.createdFolders ?? [], operationIds), duplicateDeselected)
              : clarificationMessage ?? agentPlanStatusLabel(run?.status)}
          </p>
          {plan && isAwaiting && !isSelectionValid && (
            <p className={styles["notice-hint"]}>
              {selectedCount === 0
                ? "적용할 항목을 하나 이상 선택해주세요."
                : `일부만 적용할 때는 한 번에 작업 ${MAX_SELECTED_OPERATIONS}개까지 고를 수 있어요. 선택을 줄이거나 모두 선택해주세요.`}
            </p>
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
                onClick={() => mutation.mutate({ decision: "reject" }, { onSuccess: onClose })}
              >
                <Image src={cancelIcon} alt="" />
                취소
              </button>
              <button
                type="button"
                className={cx(styles.action, styles["is-primary"])}
                disabled={!canApply || busy}
                onClick={() => mutation.mutate({ decision: "approve", operationIds })}
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
