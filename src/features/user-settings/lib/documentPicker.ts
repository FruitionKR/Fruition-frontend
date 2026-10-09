import type { DocumentItemResponse } from "@/entities/document/model/document";
import { hasMarkdownExtension, hasPdfExtension, hasTextExtension, isDocumentConverting, isMarkdownDocument } from "@/entities/document/lib/documentKind";
import { normalizeTreeName } from "@/entities/tree/lib/names";
import { ApiError } from "@/shared/lib/errors";

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
export function skillReferenceFileError(file: Pick<File, "name">): string | null {
  if (hasPdfExtension(file.name)) {
    return "PDF는 참고 문서로 올릴 수 없습니다. Markdown(.md)이나 텍스트(.txt) 파일을 올려 주세요.";
  }
  if (!hasMarkdownExtension(file.name) && !hasTextExtension(file.name)) {
    return "Markdown(.md)이나 텍스트(.txt) 파일만 참고 문서로 올릴 수 있습니다.";
  }
  return null;
}

/** 참고 문서 업로드 실패를 사유별 안내로 바꾼다. */
export function describeSkillReferenceUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return "Markdown 파일은 5MB 이하만 참고 문서로 올릴 수 있습니다.";
    if (error.status === 415) return "Markdown(.md)이나 텍스트(.txt) 파일만 참고 문서로 올릴 수 있습니다.";
    if (error.code === "DUPLICATE_NAME") return "같은 이름의 참고 문서가 이미 있습니다. 파일 이름을 바꿔 다시 올려 주세요.";
    if (error.status === 409) return "같은 업로드 요청이 처리 중입니다. 잠시 후 다시 시도해 주세요.";
    if (error.status === 400) return "참고 문서로 올릴 수 없는 파일입니다. 파일을 확인하고 다시 올려 주세요.";
  }
  return "참고 문서를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
