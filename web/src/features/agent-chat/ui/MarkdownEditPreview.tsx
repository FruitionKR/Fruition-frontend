import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import type { MarkdownEditPreview as MarkdownEditPreviewData } from "../lib/agentTurn";
import { DocumentDiffLines } from "./DocumentDiffLines";
import styles from "./AgentChat.module.css";

export function MarkdownEditPreview({
  preview,
  validationError,
  hasProposals,
  isLoading,
  onApply,
  onCancel,
  onOpenAsNewDocument,
  newDocumentBlockedReason = null,
  onRegenerate
}: {
  preview: MarkdownEditPreviewData;
  validationError: string | null;
  /** 원문과 달라진 제안이 있는지. "변경하지 않았다"는 응답은 수락할 것이 없다. */
  hasProposals: boolean;
  isLoading: boolean;
  onApply: () => void;
  onCancel: () => void;
  onOpenAsNewDocument: () => void;
  /** 새 문서를 만들 폴더에 넣을 권한이 없으면 이유. "새 문서로 열기"만 막고 이유를 보여 준다. */
  newDocumentBlockedReason?: string | null;
  onRegenerate: () => void;
}) {
  return (
    <section className={styles["markdown-edit-preview"]} aria-label="AI Markdown 편집 제안">
      <header>
        <div>
          <strong>{preview.summary}</strong>
          <details className={styles["markdown-edit-details"]}>
            <summary>
              <p>{preview.replacementMarkdown}</p>
              <span className={styles["markdown-edit-details-label"]}>변경 내용 자세히 보기</span>
            </summary>
            <DocumentDiffLines label="원문과 편집안 line diff" groups={[{ key: "all", lines: preview.diffLines }]} />
            <div className={styles["markdown-edit-rendered-preview"]}>
              <MarkdownViewer markdown={preview.replacementMarkdown} linkPolicy="inert-external" />
            </div>
          </details>
        </div>
      </header>

      {validationError && <p className={styles["markdown-edit-error"]} role="alert">{validationError}</p>}
      {newDocumentBlockedReason && <p className={styles["markdown-edit-error"]} role="status">{newDocumentBlockedReason}</p>}

      <footer>
        <button type="button" disabled={isLoading} onClick={onCancel}>취소</button>
        <button type="button" disabled={isLoading} onClick={onRegenerate}>
          {isLoading ? "재시도 중" : "재시도"}
        </button>
        <button type="button" disabled={isLoading || Boolean(newDocumentBlockedReason)} onClick={onOpenAsNewDocument}>새 문서로 열기</button>
        {hasProposals && (
          <button type="button" className={styles["is-primary"]} disabled={isLoading || Boolean(validationError)} onClick={onApply}>
            수락
          </button>
        )}
      </footer>
    </section>
  );
}
