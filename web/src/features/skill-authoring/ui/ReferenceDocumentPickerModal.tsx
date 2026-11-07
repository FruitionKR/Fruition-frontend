"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import type { DocumentItemResponse } from "@/entities/document";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import { SearchModalHeader } from "@/shared/ui/modal/SearchModalHeader";
import { fileIcon, plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import {
  describeSkillReferenceUploadError,
  documentDisplayName,
  orderPickerDocuments,
  pickerDocuments,
  skillReferenceFileError
} from "../lib/referenceDocumentPicker";
// 검색 결과 리스트 스타일은 스킬 검색 모달과 동일한 형태를 쓴다.
import styles from "../../../widgets/skills-view/ui/SkillSearchModal.module.css";
import pickerStyles from "./ReferenceDocumentPickerModal.module.css";

/**
 * 참고 문서 선택 모달. 네비게이션 문서 검색과 같은 중앙 모달 UX로, 클릭 시 선택/해제를 토글한다.
 * Markdown 문서만 목록에 보이고 고를 수 있다. PDF 등 다른 파일은 목록에 넣지 않는다.
 * 스킬 참고 문서(메인 트리에 나오지 않는 전용 업로드)를 함께 보여 주고, 여기서 Markdown·txt를 참고 문서로 올릴 수 있다.
 * 작업 입력창의 "+ 문서 추가"도 이 창을 쓴다(업로드 없이 고르기만 한다).
 */
export function ReferenceDocumentPickerModal({
  documents,
  referenceDocuments,
  selectedDocs,
  maxCount,
  onToggle,
  onUpload,
  onClose,
  ariaLabel,
  placeholder,
  emptyMessage,
  documentMeta,
  filterDocuments = pickerDocuments
}: {
  documents: DocumentItemResponse[];
  referenceDocuments: DocumentItemResponse[];
  selectedDocs: DocumentItemResponse[];
  maxCount: number;
  onToggle: (doc: DocumentItemResponse) => void;
  /** 참고 문서로 올리고 선택한다. 올린 문서를 돌려준다. 없으면 올리기 줄을 두지 않는다. */
  onUpload?: (file: File) => Promise<DocumentItemResponse>;
  onClose: () => void;
  ariaLabel?: string;
  placeholder?: string;
  /** 검색어 없이 목록이 비었을 때의 안내(불러오는 중·실패) */
  emptyMessage?: string | null;
  /** 항목 오른쪽에 보일 설명 */
  documentMeta?: (doc: DocumentItemResponse) => string | null;
  /** 검색어로 목록을 거른다. 기본은 스킬 참고 문서 기준이다. */
  filterDocuments?: (documents: DocumentItemResponse[], query: string) => DocumentItemResponse[];
}) {
  const t = useTranslations("skills");
  const tShared = useTranslations("shared");
  const modalLabel = ariaLabel ?? t("picker.ariaLabel");
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 열 때 선택돼 있던 문서와 여기서 올린 문서를 맨 앞에 고정한다. 토글할 때마다 순서가 바뀌지 않게 한다.
  const [pinnedDocs, setPinnedDocs] = useState(selectedDocs);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedIds = selectedDocs.map((doc) => doc.id);
  const isFull = selectedIds.length >= maxCount;
  const hasQuery = query.trim() !== "";
  const results = useMemo(
    () => filterDocuments(orderPickerDocuments(pinnedDocs, referenceDocuments, documents), query),
    [filterDocuments, pinnedDocs, referenceDocuments, documents, query]
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUpload) return;
    const invalid = skillReferenceFileError(file, t);
    setUploadError(invalid);
    if (invalid) return;
    setIsUploading(true);
    try {
      const uploaded = await onUpload(file);
      setPinnedDocs((current) => [uploaded, ...current.filter((doc) => doc.id !== uploaded.id)]);
      setQuery("");
    } catch (error) {
      setUploadError(describeSkillReferenceUploadError(error, t, tShared));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <CenteredModal ariaLabel={modalLabel} onClose={onClose}>
      <SearchModalHeader
        placeholder={placeholder ?? t("picker.placeholder", { count: selectedIds.length, max: maxCount })}
        value={query}
        onChange={setQuery}
        onClose={onClose}
      />
      <div className={styles["search-body"]}>
        {/* 참고 문서 전용 업로드. 메인 문서 트리에는 나오지 않는다. 선택 개수가 다 차면 막는다. */}
        {onUpload && <div className={pickerStyles["upload-row"]}>
          <button
            type="button"
            className={pickerStyles["upload-button"]}
            disabled={isUploading || isFull}
            onClick={() => fileInputRef.current?.click()}
          >
            <SvgIcon src={plusIcon} className={pickerStyles["upload-icon"]} />
            {isUploading ? t("picker.uploading") : t("picker.upload")}
          </button>
          <span className={pickerStyles["upload-hint"]}>
            {isFull ? t("picker.full", { max: maxCount }) : t("picker.uploadHint")}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(event) => void handleFileChange(event)}
          />
        </div>}
        {uploadError && (
          <p className={pickerStyles["upload-error"]} role="alert">
            {uploadError}
          </p>
        )}
        <div className={styles["search-results"]} role="group" aria-label={t("picker.resultsLabel", { label: modalLabel })}>
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
                    {isSelected ? t("picker.selected") : isReference ? t("picker.reference") : documentMeta?.(doc) ?? ""}
                  </span>
                </button>
              );
            })
          ) : (
            <p className={styles["search-empty"]}>
              {hasQuery ? t("picker.noResults") : emptyMessage ?? t("picker.empty")}
            </p>
          )}
        </div>
      </div>
    </CenteredModal>
  );
}
