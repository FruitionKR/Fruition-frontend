import { Sparkles } from "lucide-react";
import { AI_GENERATED_DESCRIPTION, AI_GENERATED_LABEL } from "@/shared/lib/aiNotice";
import { cx } from "@/shared/lib/classNames";
import styles from "./AiGeneratedBadge.module.css";

/**
 * "AI가 생성한 내용" 라벨(AI 기본법 제31조②, 이슈 #131). 채팅 답변·위키 페이지·스킬 초안·에이전트 문서 제안에 붙인다.
 * 색은 base.css의 --color-primary/--color-on-primary 토큰을 써서 라이트·다크 테마를 함께 따른다.
 * onOpenHistory를 주면 AI 변경 이력(ai-operation-logs) 화면으로 가는 버튼이 함께 보인다.
 */
export function AiGeneratedBadge({ className, onOpenHistory }: { className?: string; onOpenHistory?: () => void }) {
  return (
    <span className={cx(styles.badge, className)}>
      <span className={styles.label} title={AI_GENERATED_DESCRIPTION}>
        <Sparkles size={10} aria-hidden />
        {AI_GENERATED_LABEL}
        <span className={styles["sr-only"]}>. {AI_GENERATED_DESCRIPTION}</span>
      </span>
      {onOpenHistory && (
        <button type="button" className={styles.history} onClick={onOpenHistory}>
          변경 이력
        </button>
      )}
    </span>
  );
}
