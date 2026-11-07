import type { DocumentItemResponse } from "@/entities/document/model/document";
import { hasMarkdownExtension, hasPdfExtension, hasTextExtension, isDocumentConverting, isMarkdownDocument } from "@/entities/document/lib/documentKind";
import { normalizeTreeName } from "@/entities/tree/lib/treeNames";
import { ApiError } from "@/shared/lib/apiErrors";
import { describeLimitError } from "@/entities/workspace/model/workspaceLimits";
import type { SkillsTranslate } from "./skillsTranslate";

/** 표시용 문서 이름. macOS에서 올린 한글 파일명은 NFD(자모 분리)로 저장될 수 있어 NFC로 맞춘다. */
export function documentDisplayName(document: Pick<DocumentItemResponse, "filename">): string {
  return document.filename.normalize("NFC");
}

/**
 * 참고 문서 피커 검색. 파일명과 검색어를 모두 NFC·소문자로 맞춰 비교한다.
 * 업로드 중복 검사·서버 고유 제약이 NFC로 비교하므로, 검색도 같은 기준이어야 중복으로 막힌 문서가 보인다.
 */
export function filterPickerDocuments<T extends Pick<DocumentItemResponse, "filename">>(documents: T[], query: string): T[] {
  const normalizedQuery = normalizeTreeName(query);
  if (!normalizedQuery) return documents;
  return documents.filter((document) => normalizeTreeName(document.filename).includes(normalizedQuery));
}

/**
 * 참고 문서 후보. 스킬 검토는 참고 문서의 Markdown 본문만 읽을 수 있어서
 * (원본 PDF는 위키 편입 전에는 본문이 없어 검토가 거절된다) Markdown 문서만 보여준다.
 * PDF·TXT 등 다른 파일은 목록에 넣지 않는다. PDF는 변환된 Markdown 문서를 직접 고른다.
 * 변환 중이거나 변환에 실패한 Markdown은 본문이 placeholder라 뺀다.
 */
export function pickerDocuments(documents: DocumentItemResponse[], query: string): DocumentItemResponse[] {
  return filterPickerDocuments(documents.filter((document) => isMarkdownDocument(document) && !isUnfinishedConversion(document)), query);
}

/** 변환 실패는 failed + convert: run으로 판별한다. 변환 뒤 위키 편입만 실패한 노트는 본문이 정상이라 남긴다. */
function isUnfinishedConversion(document: DocumentItemResponse): boolean {
  return isDocumentConverting(document)
    || (document.status === "failed" && document.pipeline_run_id?.startsWith("convert:") === true);
}

/**
 * 피커 목록 순서: 고정 문서(피커를 열 때 선택돼 있던 문서·피커에서 올린 문서) → 스킬 참고 문서(서버의 최근 업로드 순) → 그 밖의 문서(최근 업로드 순).
 * 선택을 토글할 때마다 항목이 튀지 않도록 "선택됨"은 현재 선택이 아니라 고정 ID 목록으로 정한다. 같은 문서는 한 번만 넣는다.
 */
export function orderPickerDocuments(
  pinned: DocumentItemResponse[],
  referenceDocuments: DocumentItemResponse[],
  documents: DocumentItemResponse[]
): DocumentItemResponse[] {
  const byRecentUpload = [...documents].sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  const seen = new Set<string>();
  return [...pinned, ...referenceDocuments, ...byRecentUpload].filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

/** 참고 문서로 올릴 수 없는 파일이면 안내 문구를, 올릴 수 있으면 null을 준다. 1차 범위는 Markdown·txt만 받는다. */
export function skillReferenceFileError(file: Pick<File, "name">, t: SkillsTranslate): string | null {
  if (hasPdfExtension(file.name)) return t("referenceUpload.pdf");
  if (!hasMarkdownExtension(file.name) && !hasTextExtension(file.name)) return t("referenceUpload.unsupportedType");
  return null;
}

/** 참고 문서 업로드 실패를 사유별 안내로 바꾼다. */
export function describeSkillReferenceUploadError(error: unknown, t: SkillsTranslate): string {
  if (error instanceof ApiError) {
    // 용량 초과도 413이라 code로 먼저 가른다. 남은 413은 document-svc의 Markdown 본문 5MB 한도다.
    const limitMessage = describeLimitError(error);
    if (limitMessage) return limitMessage;
    if (error.status === 413) return t("referenceUpload.tooLarge");
    if (error.status === 415) return t("referenceUpload.unsupportedType");
    if (error.code === "DUPLICATE_NAME") return t("referenceUpload.duplicateName");
    if (error.status === 409) return t("referenceUpload.inProgress");
    if (error.status === 400) return t("referenceUpload.invalid");
  }
  return t("referenceUpload.failed");
}
