import type { DocumentItemResponse } from "@/entities/document/model/document";
import { useActiveLintOperation } from "@/features/wiki-ingest/model/useActiveLintOperation";
import { selectActiveIngestDocuments } from "@/features/wiki-ingest/model/wikiReflectState";
import { buildWikiWorkRows } from "@/features/wiki-ingest/model/wikiWorkList";
import styles from "./DocumentSidebar.module.css";

/** 워크스페이스에서 진행 중인 AI 작업(위키 편입·lint) 목록 팝오버 (Figma 1131:7037) */
export function WikiWorkPopover({ documents }: { documents: DocumentItemResponse[] }) {
  // 팝오버가 열려 있는 동안은 lint 진행 여부를 짧은 주기로 확인한다.
  const activeLint = useActiveLintOperation(true);
  const rows = buildWikiWorkRows(selectActiveIngestDocuments(documents), activeLint);

  return (
    <div className={styles["wiki-work-popover"]} role="dialog" aria-label="진행 중인 작업">
      <p className={styles["wiki-work-title"]}>위키 편입</p>
      {rows.length === 0 ? (
        <p className={styles["wiki-work-empty"]}>진행 중인 작업이 없습니다.</p>
      ) : (
        <ul className={styles["wiki-work-list"]}>
          {rows.map((row) => (
            <li key={row.key} className={styles["wiki-work-row"]}>
              <span className={styles["wiki-work-label"]}>{row.label}</span>
              <span>{row.startTime}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
