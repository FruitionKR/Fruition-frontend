import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isMarkdownDocument } from "@/entities/document/lib/documentKind";
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
 * 참고 문서 후보. 스킬 검토는 참고 문서의 Markdown 본문만 읽을 수 있어서
 * (원본 PDF는 위키 편입 전에는 본문이 없어 검토가 거절된다) Markdown 문서만 보여준다.
 * PDF·TXT 등 다른 파일은 목록에 넣지 않는다. PDF는 변환된 Markdown 문서를 직접 고른다.
 */
export function pickerDocuments(documents: DocumentItemResponse[], query: string): DocumentItemResponse[] {
  return filterPickerDocuments(documents.filter(isMarkdownDocument), query);
}
