import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import type { GeneratedMarkdownDraft } from "../lib/agentTurn";
import styles from "./AgentChat.module.css";
import { useTranslations } from "next-intl";

/**
 * 새 문서 초안 카드. notice는 AI 결과 message다(폴더 원문을 일부만 읽었다는 안내 등). 자르지 않고 그대로 보여 준다.
 */
export function MarkdownCreatePreview({
  draft,
  notice,
  isSubmitting,
  errorMessage,
  blockedReason = null,
  onCancel,
  onRegenerate,
  onCreate
}: {
  draft: GeneratedMarkdownDraft;
  notice?: string | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  /** 만들 폴더에 넣을 권한이 없으면 이유. 만들기를 막고 이유를 보여 준다. */
  blockedReason?: string | null;
  onCancel: () => void;
  onRegenerate: () => void;
  onCreate: () => void;
}) {
  const t = useTranslations("agentChat");
  return (
    <section className={styles["markdown-create-preview"]} aria-label={t("create.regionLabel")}>
      <header>
        <span>{t("create.heading")}</span>
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
      {blockedReason && <p className={styles["markdown-edit-error"]} role="status">{blockedReason}</p>}
      <footer>
        <button type="button" disabled={isSubmitting} onClick={onCancel}>{t("actions.cancel")}</button>
        <button type="button" disabled={isSubmitting} onClick={onRegenerate}>{t("actions.regenerate")}</button>
        <button type="button" className={styles["is-primary"]} disabled={isSubmitting || Boolean(blockedReason)} onClick={onCreate}>
          {isSubmitting ? t("create.creating") : t("create.openAsNew")}
        </button>
      </footer>
    </section>
  );
}
