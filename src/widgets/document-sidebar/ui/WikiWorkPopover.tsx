import type { DocumentItemResponse } from "@/entities/document/model/document";
import { useActiveLintOperation } from "@/features/wiki-ingest/model/useActiveLintOperation";
import { useActiveRestoreOperations } from "@/features/wiki-ingest/model/useActiveRestoreOperations";
import { selectActiveIngestDocuments } from "@/features/wiki-ingest/model/wikiReflectState";
import { buildWikiWorkSections } from "@/features/wiki-ingest/model/wikiWorkList";
import { cx } from "@/shared/lib/classNames";
import styles from "./DocumentSidebar.module.css";

/** 워크스페이스에서 진행 중인 AI 작업(위키 편입·위키 최신화·PDF→MD 변환·롤백) 목록 팝오버 (Figma 1131:7037) */
export function WikiWorkPopover({ documents }: { documents: DocumentItemResponse[] }) {
  // 팝오버가 열려 있는 동안은 lint 진행 여부를 짧은 주기로 확인한다.
  const activeLint = useActiveLintOperation(true);
  const activeRestores = useActiveRestoreOperations();

  const activeDocuments = selectActiveIngestDocuments(documents);
  const sections = buildWikiWorkSections(activeDocuments, activeLint, activeRestores);

  return (
    <div
      className={cx(styles["wiki-work-popover"], sections.length === 0 && styles["is-empty"])}
      role="dialog"
      aria-label="진행 중인 작업"
    >
      {sections.length === 0 ? (
        <p className={styles["wiki-work-empty"]}>진행 중인 작업이 없습니다</p>
      ) : (
        sections.map((section) => (
          <section key={section.kind} className={styles["wiki-work-section"]} aria-label={section.title}>
            <p className={styles["wiki-work-title"]}>{section.title}</p>
            <ul className={styles["wiki-work-list"]}>
              {section.rows.map((row) => (
                <li key={row.key} className={styles["wiki-work-row"]}>
                  <span className={styles["wiki-work-label"]}>{row.label}</span>
                  <span>{row.startTime}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
