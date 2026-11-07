"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import { SearchModalHeader } from "@/shared/ui/modal/SearchModalHeader";
import { fileIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import type { SelectableTreeItem } from "@/widgets/document-sidebar/model/treeInteraction";
import type { Project } from "@/entities/tree/model/tree";
import { ROOT_DOCUMENTS_TITLE } from "@/entities/tree/lib/projectsFromServerTree";
import { useDocumentSearch, type SearchHit } from "../model/useDocumentSearch";
import styles from "./DocumentSearch.module.css";

/** 중앙 검색 모달 (Figma 757:17248). 문서명을 클라이언트 필터링하고, 결과 클릭 시 해당 문서를 연다. */
export function DocumentSearch({
  projects,
  onSelectGraphNode,
  onClose
}: {
  projects: Project[];
  onSelectGraphNode: (item: SelectableTreeItem) => void;
  onClose: () => void;
}) {
  const { query, setQuery, normalizedQuery, results, overflowCount } = useDocumentSearch(projects);
  const t = useTranslations("documents");
  const tShared = useTranslations("shared");
  // 트리의 최상위 이름은 저장값(한국어)이라 화면에 보일 때 지금 언어로 옮긴다.
  const projectLabel = (title: string) => (title === ROOT_DOCUMENTS_TITLE ? t("tree.rootTitle") : title);

  function handleSelect(event: ReactMouseEvent<HTMLButtonElement>, item: SearchHit) {
    event.stopPropagation();
    onSelectGraphNode(item);
    onClose();
  }

  return (
    <CenteredModal ariaLabel={t("search.label")} onClose={onClose}>
      <SearchModalHeader placeholder={t("search.label")} value={query} onChange={setQuery} onClose={onClose} />
      <div className={styles["search-body"]}>
        <div className={styles["search-results"]} role="group" aria-label={t("search.resultsLabel")}>
          {results.length > 0 ? (
            <>
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles["search-result"]}
                  onClick={(event) => handleSelect(event, item)}
                >
                  <span className={styles["search-result-title"]}>
                    <SvgIcon src={fileIcon} className={styles["search-result-icon"]} />
                    <span className={styles["search-result-label"]}>{item.label}</span>
                  </span>
                  <span className={styles["search-result-meta"]}>
                    {item.updatedAt ? formatRelativeTime(item.updatedAt, tShared) : projectLabel(item.projectTitle)}
                  </span>
                </button>
              ))}
              {overflowCount > 0 ? (
                <p className={styles["search-more"]}>{t("search.more", { count: overflowCount })}</p>
              ) : null}
            </>
          ) : (
            <p className={styles["search-empty"]}>
              {normalizedQuery ? t("search.noResults") : t("search.empty")}
            </p>
          )}
        </div>
      </div>
    </CenteredModal>
  );
}
