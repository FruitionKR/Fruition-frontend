import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting, isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";
import { normalizeTreeName } from "@/entities/tree/lib/names";

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
 * 피커 한 줄. document는 목록에 보이는 문서, target은 선택하면 참고 문서로 보낼 Markdown 문서다.
 * target이 null이면 고를 수 없고 notice로 이유를 안내한다.
 */
export type PickerCandidate = {
  document: DocumentItemResponse;
  target: DocumentItemResponse | null;
  notice: string | null;
};

export const PDF_NOT_CONVERTED_NOTICE = "Markdown으로 변환한 뒤 고를 수 있어요";
export const PDF_CONVERTING_NOTICE = "Markdown으로 변환하는 중이에요";
export const PDF_CONVERTED_NOTICE = "변환된 Markdown으로 선택돼요";

/**
 * 참고 문서 후보를 만든다. 스킬 검토는 참고 문서의 Markdown 본문만 읽을 수 있어서
 * (원본 PDF는 위키 편입 전에는 본문이 없어 검토가 거절된다) Markdown 문서와 PDF만 보여준다.
 * PDF는 변환이 끝난 Markdown 변환본으로 대신 선택하고, 변환본이 없거나 변환 중이면 고를 수 없게 안내한다.
 */
export function pickerCandidates(documents: DocumentItemResponse[], query: string): PickerCandidate[] {
  return filterPickerDocuments(documents, query).flatMap((document): PickerCandidate[] => {
    if (isMarkdownDocument(document)) return [{ document, target: document, notice: null }];
    if (!isPdfDocument(document)) return [];
    const converted = documents.filter((item) => item.source_document_id === document.id && isMarkdownDocument(item));
    const ready = converted.find((item) => item.status !== "failed" && !isDocumentConverting(item));
    if (ready) return [{ document, target: ready, notice: PDF_CONVERTED_NOTICE }];
    const notice = converted.some((item) => isDocumentConverting(item)) ? PDF_CONVERTING_NOTICE : PDF_NOT_CONVERTED_NOTICE;
    return [{ document, target: null, notice }];
  });
}
