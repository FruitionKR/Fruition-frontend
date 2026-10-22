import Image from "next/image";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import warningIcon from "@/shared/assets/svg/agent/organize-warning-circle.svg";
import tooltipArrowIcon from "@/shared/assets/svg/agent/organize-tooltip-arrow.svg";
import noticeTailIcon from "@/shared/assets/svg/agent/organize-notice-tail.svg";
import taskAcceptIcon from "@/shared/assets/svg/agent/task-accept.svg";
import taskRejectIcon from "@/shared/assets/svg/agent/task-reject.svg";
import { cx } from "@/shared/lib/classNames";
import type { EditProposalDecision, EditProposalDecisions, EditReviewSegment } from "../lib/inlineEditReview";
import styles from "./InlineEditReview.module.css";

/** 열린 문서 본문에 붙여 보여 줄 편집 제안(Figma 1571:27625). 작업 탭 카드와 같은 결정을 공유한다. */
export type InlineEditReviewState = {
  documentId: string;
  /** "[제안 : /research-summary]"의 출처 */
  sourceLabel: string;
  segments: EditReviewSegment[];
  decisions: EditProposalDecisions;
  pendingCount: number;
  isBusy: boolean;
  onDecide: (index: number, decision: EditProposalDecision) => void;
};

/** 거절·수락 버튼 쌍(Figma 1610:2831·1610:9147). 본문 제안과 작업 탭 카드가 함께 쓴다. */
export function ProposalDecisionButtons({
  disabled,
  onDecide,
  label
}: {
  disabled: boolean;
  onDecide: (decision: EditProposalDecision) => void;
  /** 버튼 접근 이름에 붙일 대상 */
  label?: string;
}) {
  return (
    <div className={styles.decisions}>
      <button type="button" className={cx(styles.decision, styles["is-reject"])} disabled={disabled} aria-label={label ? `${label} 거절` : undefined} onClick={() => onDecide("rejected")}>
        <Image src={taskRejectIcon} alt="" />
        거절
      </button>
      <button type="button" className={styles.decision} disabled={disabled} aria-label={label ? `${label} 수락` : undefined} onClick={() => onDecide("accepted")}>
        <Image src={taskAcceptIcon} alt="" />
        수락
      </button>
    </div>
  );
}

/** 문서 제목 옆 "제안 N건 진행 중"(Figma 1610:8929): 주황 느낌표 + 왼쪽 꼬리 말풍선. */
export function EditProposalBadge({ count }: { count: number }) {
  return (
    <div className={styles.badge}>
      <Image src={warningIcon} alt="" />
      <span className={styles["badge-arrow"]} aria-hidden="true"><Image src={tooltipArrowIcon} alt="" /></span>
      <span className={styles["badge-label"]} role="status">제안 {count}건 진행 중</span>
    </div>
  );
}

function SegmentText({ lines, className }: { lines: string[]; className?: string }) {
  const markdown = lines.join("\n");
  if (!markdown.trim()) return null;
  return (
    <div className={className}>
      <MarkdownViewer markdown={markdown} linkPolicy="inert-external" />
    </div>
  );
}

/**
 * 편집 제안을 원문 위치에 보여 주는 본문(Figma 1571:27846): 지울 원문은 빨간 취소선, 그 아래 꼬리 달린 파란 제안 상자에
 * "[제안 : 출처]"·편집안·거절/수락. 정한 제안은 고른 쪽 글로만 남는다.
 */
export function InlineEditReview({ review }: { review: InlineEditReviewState }) {
  return (
    <div className={styles.review} aria-label="AI 편집 제안 검토">
      {review.segments.map((segment, position) => {
        if (segment.kind === "text") return <SegmentText key={`text-${position}`} lines={segment.lines} />;
        const decision = review.decisions[segment.index];
        if (decision) {
          return <SegmentText key={`proposal-${segment.index}`} lines={decision === "accepted" ? segment.proposedLines : segment.originalLines} />;
        }
        const hasProposedText = segment.proposedLines.some((line) => line.trim());
        return (
          <section key={`proposal-${segment.index}`} className={styles.proposal} aria-label={`제안 ${segment.index + 1}`}>
            <SegmentText lines={segment.originalLines} className={styles.original} />
            <div className={styles.notice}>
              <Image src={noticeTailIcon} alt="" className={styles["notice-tail"]} />
              <p className={styles["notice-source"]}>[제안 : {review.sourceLabel}]</p>
              {hasProposedText
                ? <SegmentText lines={segment.proposedLines} className={styles["notice-text"]} />
                : <p className={styles["notice-source"]}>이 부분을 지웁니다.</p>}
              <ProposalDecisionButtons
                disabled={review.isBusy}
                label={`제안 ${segment.index + 1}`}
                onDecide={(next) => review.onDecide(segment.index, next)}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
