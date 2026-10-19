"use client";

import Image from "next/image";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import mutedLightningIcon from "@/shared/assets/svg/agent/organize-lightning-muted.svg";
import lightningSmallIcon from "@/shared/assets/svg/common/lightning-small.svg";
import { agentPlanStatusLabel, canApproveAgentPlan } from "../lib/agentPlan";
import { buildFolderOrganizeView, parseSkillCommand } from "../lib/folderOrganize";
import { useAgentPlanRun } from "../model/useAgentPlanRun";
import styles from "./FolderOrganize.module.css";

/**
 * 채팅의 폴더 정리 결과 카드 (Figma 1656:11846). 변경 목록은 메인 영역의 미리보기 탭에서 검토·승인한다.
 */
export function FolderOrganizeCard({
  turnId,
  question,
  createdAt,
  onOpenPreview
}: {
  turnId?: string;
  question: string | null;
  createdAt: string;
  onOpenPreview?: () => void;
}) {
  const { run, plan, tree, error, clarificationMessage } = useAgentPlanRun(turnId);
  const view = plan ? buildFolderOrganizeView(plan, tree ?? []) : null;
  const { command } = parseSkillCommand(question);
  const isAwaiting = canApproveAgentPlan(run);

  return (
    <div className={styles["card-group"]}>
      <p className={styles["card-caption"]} role="status">
        {isAwaiting ? "확인 필요" : !run && error ? "계획 조회 실패" : agentPlanStatusLabel(run?.status)}
      </p>
      <div className={styles.card}>
        <div className={styles["card-meta"]}>
          <span className={styles["card-command"]}>
            <Image src={mutedLightningIcon} alt="" />
            문서 : {command ?? "폴더 정리"}
          </span>
          <time dateTime={createdAt}>{formatRelativeTime(createdAt)}</time>
        </div>
        {view && (
          <div className={styles["card-text"]}>
            <p className={styles["card-title"]}>
              대상 : {view.targetFolderName ? `${view.targetFolderName} 폴더 (파일 ${view.rows.length}개)` : `파일 ${view.rows.length}개`}
            </p>
            <p className={styles["card-summary"]}>
              변경 {view.rows.length}개 제안{isAwaiting ? " • 미리보기 탭에서 확인하세요." : ""}
            </p>
          </div>
        )}
        {clarificationMessage && <p className={styles["card-summary"]}>{clarificationMessage}</p>}
        {error && <p className={styles["card-error"]} role="alert">{typeof error === "string" ? error : getErrorMessage(error, "계획을 불러오지 못했습니다.")}</p>}
      </div>
      {plan && onOpenPreview && (
        <button type="button" className={styles["open-preview"]} onClick={onOpenPreview}>
          <Image src={lightningSmallIcon} alt="" />
          미리보기 탭 열기
        </button>
      )}
    </div>
  );
}
