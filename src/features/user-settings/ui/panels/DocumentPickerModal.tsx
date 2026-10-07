"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentItemResponse } from "@/entities/document";
import { CenteredModal } from "@/shared/ui/CenteredModal";
import modalStyles from "@/shared/ui/CenteredModal.module.css";
import { fileIcon, plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { documentDisplayName, filterPickerDocuments } from "../../lib/documentPicker";
// 검색 결과 리스트 스타일은 스킬 검색 모달과 동일한 형태를 쓴다.
import styles from "./SkillSearchModal.module.css";

/** 참고 문서 선택 모달. 네비게이션 문서 검색과 같은 중앙 모달 UX로, 클릭 시 선택/해제를 토글한다. */
export function DocumentPickerModal({
  documents,
  selectedIds,
  maxCount,
  onToggle,
  onClose
}: {
  documents: DocumentItemResponse[];
  selectedIds: string[];
  maxCount: number;
  onToggle: (doc: DocumentItemResponse) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasQuery = query.trim() !== "";
  const results = useMemo(() => filterPickerDocuments(documents, query), [documents, query]);

  return (
    <CenteredModal ariaLabel="참고 문서 검색" onClose={onClose}>
      <div className={modalStyles["modal-header"]}>
        <input
          ref={inputRef}
          type="text"
          placeholder={`참고 문서 검색 (${selectedIds.length}/${maxCount} 선택)`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className={modalStyles["modal-close"]} aria-label="검색 닫기" onClick={onClose}>
          <SvgIcon src={plusIcon} className={modalStyles["modal-close-icon"]} />
        </button>
      </div>
      <div className={styles["search-body"]}>
        <div className={styles["search-results"]} role="group" aria-label="참고 문서 검색 결과">
          {results.length > 0 ? (
            results.map((doc) => {
              const isSelected = selectedIds.includes(doc.id);
              const isFull = !isSelected && selectedIds.length >= maxCount;
              return (
                <button
                  key={doc.id}
                  type="button"
                  className={styles["search-result"]}
                  aria-pressed={isSelected}
                  disabled={isFull}
                  onClick={() => onToggle(doc)}
                >
                  <span className={styles["search-result-title"]}>
                    <SvgIcon src={fileIcon} className={styles["search-result-icon"]} />
                    <span className={styles["search-result-label"]}>{documentDisplayName(doc)}</span>
                  </span>
                  <span className={styles["search-result-meta"]}>{isSelected ? "선택됨 ✓" : ""}</span>
                </button>
              );
            })
          ) : (
            <p className={styles["search-empty"]}>
              {hasQuery ? "검색 결과가 없습니다." : "선택할 문서가 없습니다."}
            </p>
          )}
        </div>
      </div>
    </CenteredModal>
  );
}
