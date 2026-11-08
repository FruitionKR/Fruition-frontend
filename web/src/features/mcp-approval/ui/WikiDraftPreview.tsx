import { lineDiff } from "@/shared/lib/lineDiff";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import { DocumentDiffLines } from "@/features/agent-chat/ui/DocumentDiffLines";
import { useTranslations } from "next-intl";
import { mcpWikiChangeGroups, type McpWikiPreview } from "../lib/wikiDraftPreview";
import styles from "./McpApprovalPage.module.css";

export function WikiDraftPreview({ preview }: { preview: McpWikiPreview }) {
  const t = useTranslations("mcpApproval.wiki.preview");
  return (
    <section className={styles.wikiPreview} aria-label="Wiki draft full preview">
      <section>
        <h2>{t("sources")}</h2>
        <dl className={styles.details}>
          {preview.source_documents.map((source) => (
            <div key={source.document_id}>
              <dt>{source.document_id}</dt>
              <dd>{t("version", { version: source.source_version })}</dd>
              <dd className={styles.hash}>{source.source_content_hash}</dd>
            </div>
          ))}
        </dl>
      </section>
      {preview.target_pages.length > 0 && (
        <section>
          <h2>{t("targets")}</h2>
          <dl className={styles.details}>
            {preview.target_pages.map((target) => (
              <div key={target.page_id}>
                <dt>{target.page_id}</dt>
                <dd>{t("version", { version: target.version })}</dd>
                <dd className={styles.hash}>{target.content_hash}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {mcpWikiChangeGroups(preview).map((group) => (
        <section key={group.kind}>
          <h2>{t(`kinds.${group.kind}`)}</h2>
          {group.changes.map((change) => (
            <article className={styles.wikiChange} key={change.change_id}>
              <header>
                <strong>{t(`actions.${change.action}`)}</strong>
                <span>{change.change_id}</span>
                <span>{change.page_id}</span>
                {change.subject_id && <span>{change.subject_id}</span>}
              </header>
              <DocumentDiffLines
                label={`${change.kind} ${change.action}`}
                groups={[{ key: change.change_id, lines: lineDiff(change.before_text ?? "", change.after_text ?? "") }]}
              />
              {change.after_text !== null && (
                <div className={styles.wikiRenderedPreview}>
                  <MarkdownViewer markdown={change.after_text} linkPolicy="inert-external" />
                </div>
              )}
              {change.evidence.length > 0 && (
                <ul className={styles.wikiEvidence}>
                  {change.evidence.map((item) => (
                    <li key={`${item.document_id}:${item.block_id}`}>
                      <strong>{item.document_id} · {item.block_id}</strong>
                      <blockquote>{item.quote}</blockquote>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      ))}
    </section>
  );
}
