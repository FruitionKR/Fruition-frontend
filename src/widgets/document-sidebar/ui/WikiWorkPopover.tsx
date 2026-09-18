import { useEffect, useState } from "react";
import type { DocumentItemResponse } from "@/entities/document/model/document";
import { subscribeConvertStarted } from "@/entities/document";
import { useActiveLintOperation } from "@/features/wiki-ingest/model/useActiveLintOperation";
import { selectActiveIngestDocuments } from "@/features/wiki-ingest/model/wikiReflectState";
import { buildWikiWorkSections } from "@/features/wiki-ingest/model/wikiWorkList";
import styles from "./DocumentSidebar.module.css";

// 이 세션에서 변환을 시작한 문서 id. 팝오버가 닫혀 있어도 누적되도록 모듈 스코프에 둔다.
const convertingIds = new Set<string>();
subscribeConvertStarted((documentId) => convertingIds.add(documentId));

/** 워크스페이스에서 진행 중인 AI 작업(위키 편입·위키 최신화·PDF→MD 변환) 목록 팝오버 (Figma 1131:7037) */
export function WikiWorkPopover({ documents }: { documents: DocumentItemResponse[] }) {
  // 팝오버가 열려 있는 동안은 lint 진행 여부를 짧은 주기로 확인한다.
  const activeLint = useActiveLintOperation(true);
  const [, setVersion] = useState(0);
  useEffect(() => subscribeConvertStarted(() => setVersion((value) => value + 1)), []);

  const activeDocuments = selectActiveIngestDocuments(documents);
  // 처리가 끝난 문서는 변환 집합에서 제거해 다음 ingest 때 잘못 분류되지 않게 한다.
  const activeIds = new Set(activeDocuments.map((document) => document.id));
  for (const id of convertingIds) if (!activeIds.has(id)) convertingIds.delete(id);

  const sections = buildWikiWorkSections(activeDocuments, activeLint, convertingIds);

  return (
    <div className={styles["wiki-work-popover"]} role="dialog" aria-label="진행 중인 작업">
      {sections.length === 0 ? (
        <p className={styles["wiki-work-empty"]}>진행 중인 작업이 없습니다.</p>
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
