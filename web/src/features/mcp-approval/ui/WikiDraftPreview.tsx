import { useTranslations } from "next-intl";
import { buildWorkspaceHref } from "@/widgets/workspace/lib/workspaceLocation";
import {
  mcpWikiSourceName,
  mcpWikiSummaryGroups,
  type McpWikiPreview,
  type McpWikiSummaryItem,
  type McpWikiSummaryKind
} from "../lib/wikiDraftPreview";
import styles from "./McpApprovalPage.module.css";

const KIND_TONE: Record<McpWikiSummaryKind, "add" | "change" | "remove"> = {
  CONCEPT_CREATE: "add",
  SOURCE_PAGE: "add",
  STATEMENT_ADD: "add",
  LINK_ADD: "add",
  STATEMENT_UPDATE: "change",
  CONCEPT_MERGE: "change",
  STATEMENT_REMOVE: "remove",
  EVIDENCE_INVALIDATION: "remove",
  LINK_REMOVE: "remove",
  CONCEPT_DELETE: "remove"
};

/**
 * 위키 초안의 변경을 사람이 읽는 요약으로 보여 준다. 위키 본문(Markdown)·diff·내부 ID·해시는 보여 주지 않는다.
 * canOpenSources: 근거 링크(/home?doc=…)는 지금 선택된 워크스페이스에서 열리므로, 초안 워크스페이스와 같을 때만 켠다.
 */
export function WikiDraftPreview({ preview, canOpenSources }: { preview: McpWikiPreview; canOpenSources: boolean }) {
  const t = useTranslations("mcpApproval.wiki.summary");
  const groups = mcpWikiSummaryGroups(preview.summary);
  return (
    <section className={styles.wikiPreview} aria-labelledby="mcp-wiki-summary-title">
      <h2 id="mcp-wiki-summary-title">{t("title")}</h2>
      {groups.length === 0 ? <p className={styles.wikiSummaryNote}>{t("legacy")}</p> : (
        <>
          <p className={styles.wikiSummaryNote}>{t("intro")}</p>
          {groups.map((group) => {
            const title = group.title.trim() || t("untitled");
            return (
              <section className={styles.wikiConcept} key={group.title} aria-label={title}>
                <h3>{title}</h3>
                <ul className={styles.wikiSummaryList}>
                  {group.entries.map((entry, index) => entry.type === "item"
                    ? <SummaryItem key={index} item={entry.item} preview={preview} canOpenSources={canOpenSources} />
                    : <li key={index} className={styles.wikiSummaryItem}>
                      <p className={styles.wikiSummaryLine}>
                        <span className={styles.wikiKind} data-tone="remove">{t("kinds.EVIDENCE_INVALIDATION")}</span>
                        <span>{t(entry.others ? "otherInvalidations" : "invalidations", { count: entry.count })}</span>
                      </p>
                    </li>)}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}

function SummaryItem({ item, preview, canOpenSources }: { item: McpWikiSummaryItem; preview: McpWikiPreview; canOpenSources: boolean }) {
  const t = useTranslations("mcpApproval.wiki.summary");
  return (
    <li className={styles.wikiSummaryItem}>
      <p className={styles.wikiSummaryLine}>
        <span className={styles.wikiKind} data-tone={KIND_TONE[item.kind]}>{t(`kinds.${item.kind}`)}</span>
        <SummaryText item={item} />
      </p>
      {item.evidence.length > 0 && (
        <ul className={styles.wikiEvidence} aria-label={t("evidence")}>
          {item.evidence.map((evidence, index) => {
            const name = mcpWikiSourceName(preview, evidence.document_id) ?? t("sourceFallback");
            const href = buildWorkspaceHref({ kind: "document", documentId: evidence.document_id, blockIds: [evidence.block_id] });
            return (
              <li key={`${evidence.document_id}:${evidence.block_id}:${index}`}>
                <figure>
                  <blockquote>{evidence.quote}</blockquote>
                  <figcaption>
                    <cite>{name}</cite>
                    {canOpenSources && (
                      <a href={href} target="_blank" rel="noopener" aria-label={t("openSourceLabel", { name })}>{t("openSource")}</a>
                    )}
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function Arrow({ symbol, label }: { symbol: string; label: string }) {
  return <> <span aria-hidden="true">{symbol}</span><span className={styles.srOnly}>{label}</span> </>;
}

function SummaryText({ item }: { item: McpWikiSummaryItem }) {
  const t = useTranslations("mcpApproval.wiki.summary");
  const title = item.page_title.trim() || t("untitled");
  switch (item.kind) {
    case "STATEMENT_UPDATE":
      return (
        <span>
          {item.before_text !== null && <><q className={styles.wikiBefore}>{item.before_text}</q><Arrow symbol="→" label={t("changedTo")} /></>}
          {item.text !== null && <q>{item.text}</q>}
        </span>
      );
    case "LINK_ADD":
    case "LINK_REMOVE":
      return <span>{title}{item.related_page_title && <><Arrow symbol="↔" label={t("linkedWith")} />{item.related_page_title}</>}</span>;
    case "CONCEPT_MERGE":
      return <span>{title}{item.related_page_title && <><Arrow symbol="→" label={t("mergedInto")} />{item.related_page_title}</>}</span>;
    case "STATEMENT_REMOVE": {
      const text = item.text ?? item.before_text;
      return text === null ? null : <q>{text}</q>;
    }
    default:
      return item.text === null ? null : <q>{item.text}</q>;
  }
}
