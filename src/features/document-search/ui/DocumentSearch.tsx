"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import { SearchModalHeader } from "@/shared/ui/modal/SearchModalHeader";
import { fileIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import type { SelectableTreeItem } from "@/widgets/document-sidebar/model/treeInteraction";
import type { Project } from "@/entities/tree/model/tree";
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

  function handleSelect(event: ReactMouseEvent<HTMLButtonElement>, item: SearchHit) {
    event.stopPropagation();
    onSelectGraphNode(item);
    onClose();
  }

  return (
    <CenteredModal ariaLabel="채팅 및 프로젝트 검색" onClose={onClose}>
      <SearchModalHeader placeholder="채팅 및 프로젝트 검색" value={query} onChange={setQuery} onClose={onClose} />
      <div className={styles["search-body"]}>
        <div className={styles["search-results"]} role="group" aria-label="문서 검색 결과">
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
                    {item.updatedAt ? formatRelativeTime(item.updatedAt) : item.projectTitle}
                  </span>
                </button>
              ))}
              {overflowCount > 0 ? (
                <p className={styles["search-more"]}>외 {overflowCount}개 더 있습니다. 검색어를 좁혀 주세요.</p>
              ) : null}
            </>
          ) : (
            <p className={styles["search-empty"]}>
              {normalizedQuery ? "검색 결과가 없습니다." : "표시할 문서가 없습니다."}
            </p>
          )}
        </div>
      </div>
    </CenteredModal>
  );
}
