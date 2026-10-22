import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting, isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";

/** 문서 트리 행의 확장자 배지를 PDF ↔ 변환본 관계로 바꿔 그릴 때 쓰는 값 */
export type TreeConversionBadge = {
  /** 현재 문서의 역할. 원본 PDF 또는 변환본 */
  label: string;
  /** 변환을 마친 PDF 원본이면 true */
  isConverted: boolean;
  /** title·aria-label로 읽히는 짝 문서 설명 */
  description: string;
  /** 배지를 눌렀을 때 열 짝 문서. 삭제 등으로 없으면 링크를 만들지 않는다. */
  relatedDocumentId: string | null;
};

export const CONVERTED_MARKDOWN_LABEL = "변환본";
const CONVERTED_SOURCE_LABEL = "원본 PDF";
const UNKNOWN_SOURCE_DESCRIPTION = "PDF에서 만든 Markdown 문서입니다. 원본 PDF를 찾을 수 없습니다.";

function isFailedConversion(document: DocumentItemResponse): boolean {
  return document.status === "failed" && document.pipeline_run_id?.startsWith("convert:") === true;
}

/** 변환으로 생긴 Markdown인지. 파일명 대신 source_document_id 관계로 판단한다. */
function isConvertedMarkdown(document: DocumentItemResponse): boolean {
  return Boolean(document.source_document_id) && isMarkdownDocument(document);
}

/**
 * 문서 하나의 변환 관계 배지. 관계가 없거나 아직 표시할 상태가 아니면 null(기존 확장자 배지 유지).
 * - 변환된 노트: 원본 PDF로 연결한다. 원본이 없으면 설명만 표시한다.
 * - 원본 PDF: 변환이 끝나면 가장 최근에 생성한 변환 노트로 연결한다.
 */
export function getTreeConversionBadge(
  document: DocumentItemResponse,
  documents: DocumentItemResponse[]
): TreeConversionBadge | null {
  if (isConvertedMarkdown(document)) {
    const source = documents.find((item) => item.id === document.source_document_id);
    return {
      label: CONVERTED_MARKDOWN_LABEL,
      isConverted: false,
      description: source ? `PDF에서 만든 Markdown 문서입니다.\n[${source.filename}]` : UNKNOWN_SOURCE_DESCRIPTION,
      relatedDocumentId: source?.id ?? null
    };
  }
  if (!isPdfDocument(document) || isDocumentConverting(document)) return null;
  const converted = documents.filter((item) =>
    item.source_document_id === document.id && isMarkdownDocument(item) && !isFailedConversion(item)
  );
  if (converted.length === 0 || converted.some(isDocumentConverting)) return null;
  const latest = [...converted].sort((a, b) =>
    (Date.parse(b.uploaded_at ?? "") || 0) - (Date.parse(a.uploaded_at ?? "") || 0)
  )[0];
  return {
    label: CONVERTED_SOURCE_LABEL,
    isConverted: true,
    description: `업로드한 원본 PDF입니다.\n[${latest.filename}]`,
    relatedDocumentId: latest.id
  };
}

/** 실제로 이동할 수 있는 링크에만 클릭 안내를 붙인다. */
export function describeTreeConversionBadge(badge: TreeConversionBadge, linked = false): string {
  if (!linked || !badge.relatedDocumentId) return badge.description;
  return `${badge.description}\n클릭하면 ${badge.isConverted ? "변환본을" : "원본 PDF를"} 엽니다.`;
}

/** 문서 id별 변환 관계 배지. 관계가 없는 문서는 넣지 않는다. */
export function buildTreeConversionBadges(
  documents: DocumentItemResponse[]
): ReadonlyMap<string, TreeConversionBadge> {
  return new Map(documents.flatMap((document) => {
    const badge = getTreeConversionBadge(document, documents);
    return badge ? [[document.id, badge] as const] : [];
  }));
}
