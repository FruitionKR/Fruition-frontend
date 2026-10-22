import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import type { GeneratedMarkdownDraft } from "../lib/agentTurn";
import styles from "./AgentChat.module.css";

/**
 * 새 문서 초안 카드. notice는 AI 결과 message다(폴더 원문을 일부만 읽었다는 안내 등). 자르지 않고 그대로 보여 준다.
 */
export function MarkdownCreatePreview({
  draft,
  notice,
  isSubmitting,
  errorMessage,
  onCancel,
  onRegenerate,
  onCreate
}: {
  draft: GeneratedMarkdownDraft;
  notice?: string | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onRegenerate: () => void;
  onCreate: () => void;
}) {
  return (
    <section className={styles["markdown-create-preview"]} aria-label="AI Markdown 문서 초안">
      <header>
        <span>새 문서 초안</span>
        <strong>{draft.title}</strong>
        <p>{draft.summary}</p>
      </header>
      {notice?.trim() && (
        <p className={styles["markdown-create-notice"]} role="note">
          {notice.trim()}
        </p>
      )}
      <div className={styles["markdown-create-rendered-preview"]}>
        <MarkdownViewer markdown={draft.markdown} linkPolicy="inert-external" />
      </div>
      {errorMessage && <p className={styles["markdown-edit-error"]} role="alert">{errorMessage}</p>}
      <footer>
        <button type="button" disabled={isSubmitting} onClick={onCancel}>취소</button>
        <button type="button" disabled={isSubmitting} onClick={onRegenerate}>재생성</button>
        <button type="button" className={styles["is-primary"]} disabled={isSubmitting} onClick={onCreate}>
          {isSubmitting ? "문서 생성 중" : "새 문서로 열기"}
        </button>
      </footer>
    </section>
  );
}
