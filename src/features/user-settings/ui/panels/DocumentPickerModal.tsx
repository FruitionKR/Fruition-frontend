"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { DocumentItemResponse } from "@/entities/document";
import { CenteredModal } from "@/shared/ui/CenteredModal";
import modalStyles from "@/shared/ui/CenteredModal.module.css";
import { fileIcon, plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import {
  describeSkillReferenceUploadError,
  documentDisplayName,
  orderPickerDocuments,
  pickerDocuments,
  skillReferenceFileError
} from "../../lib/documentPicker";
// 검색 결과 리스트 스타일은 스킬 검색 모달과 동일한 형태를 쓴다.
import styles from "./SkillSearchModal.module.css";
import pickerStyles from "./DocumentPickerModal.module.css";

/**
 * 참고 문서 선택 모달. 네비게이션 문서 검색과 같은 중앙 모달 UX로, 클릭 시 선택/해제를 토글한다.
 * Markdown 문서만 목록에 보이고 고를 수 있다. PDF 등 다른 파일은 목록에 넣지 않는다.
 * 스킬 참고 문서(메인 트리에 나오지 않는 전용 업로드)를 함께 보여 주고, 여기서 Markdown·txt를 참고 문서로 올릴 수 있다.
 */
export function DocumentPickerModal({
  documents,
  referenceDocuments,
  selectedDocs,
  maxCount,
  onToggle,
  onUpload,
  onClose
}: {
  documents: DocumentItemResponse[];
  referenceDocuments: DocumentItemResponse[];
  selectedDocs: DocumentItemResponse[];
  maxCount: number;
  onToggle: (doc: DocumentItemResponse) => void;
  /** 참고 문서로 올리고 선택한다. 올린 문서를 돌려준다. */
  onUpload: (file: File) => Promise<DocumentItemResponse>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 열 때 선택돼 있던 문서와 여기서 올린 문서를 맨 앞에 고정한다. 토글할 때마다 순서가 바뀌지 않게 한다.
  const [pinnedDocs, setPinnedDocs] = useState(selectedDocs);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const selectedIds = selectedDocs.map((doc) => doc.id);
  const isFull = selectedIds.length >= maxCount;
  const hasQuery = query.trim() !== "";
  const results = useMemo(
    () => pickerDocuments(orderPickerDocuments(pinnedDocs, referenceDocuments, documents), query),
    [pinnedDocs, referenceDocuments, documents, query]
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = skillReferenceFileError(file);
    setUploadError(invalid);
    if (invalid) return;
    setIsUploading(true);
    try {
      const uploaded = await onUpload(file);
      setPinnedDocs((current) => [uploaded, ...current.filter((doc) => doc.id !== uploaded.id)]);
      setQuery("");
    } catch (error) {
      setUploadError(describeSkillReferenceUploadError(error));
    } finally {
      setIsUploading(false);
    }
  }

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
        {/* 참고 문서 전용 업로드. 메인 문서 트리에는 나오지 않는다. 선택 개수가 다 차면 막는다. */}
        <div className={pickerStyles["upload-row"]}>
          <button
            type="button"
            className={pickerStyles["upload-button"]}
            disabled={isUploading || isFull}
            onClick={() => fileInputRef.current?.click()}
          >
            <SvgIcon src={plusIcon} className={pickerStyles["upload-icon"]} />
            {isUploading ? "올리는 중…" : "참고 문서 올리기"}
          </button>
          <span className={pickerStyles["upload-hint"]}>
            {isFull ? `최대 ${maxCount}개까지 선택할 수 있습니다.` : ".md, .txt · 메인 문서 목록에는 보이지 않습니다."}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(event) => void handleFileChange(event)}
          />
        </div>
        {uploadError && (
          <p className={pickerStyles["upload-error"]} role="alert">
            {uploadError}
          </p>
        )}
        <div className={styles["search-results"]} role="group" aria-label="참고 문서 검색 결과">
          {results.length > 0 ? (
            results.map((doc) => {
              const isSelected = selectedIds.includes(doc.id);
              const isReference = referenceDocuments.some((item) => item.id === doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  className={styles["search-result"]}
                  aria-pressed={isSelected}
                  disabled={!isSelected && isFull}
                  onClick={() => onToggle(doc)}
                >
                  <span className={styles["search-result-title"]}>
                    <SvgIcon src={fileIcon} className={styles["search-result-icon"]} />
                    <span className={styles["search-result-label"]}>{documentDisplayName(doc)}</span>
                  </span>
                  <span className={styles["search-result-meta"]}>
                    {isSelected ? "선택됨 ✓" : isReference ? "참고용 업로드" : ""}
                  </span>
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
