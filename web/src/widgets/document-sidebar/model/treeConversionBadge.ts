import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting, isMarkdownDocument, isPdfDocument } from "@/entities/document/lib/documentKind";

/** 문서 트리 행의 확장자 배지를 PDF ↔ 변환본 관계로 바꿔 그릴 때 쓰는 값 */
export type TreeConversionBadge = {
  /** 확장자 배지 문구. 원본은 "PDF", 변환본은 "PDF→MD" */
  label: string;
  /** 변환을 마친 PDF 원본이면 true(배지에 작은 체크) */
  isConverted: boolean;
  /** title·aria-label로 읽히는 짝 문서 설명 */
  description: string;
};

export const CONVERTED_MARKDOWN_LABEL = "PDF→MD";
const CONVERTED_SOURCE_LABEL = "PDF";
const UNKNOWN_SOURCE_DESCRIPTION = "PDF에서 변환한 문서";

function isFailedConversion(document: DocumentItemResponse): boolean {
  return document.status === "failed" && document.pipeline_run_id?.startsWith("convert:") === true;
}

/** 변환으로 생긴 Markdown인지. 파일명 대신 source_document_id 관계로 판단한다. */
function isConvertedMarkdown(document: DocumentItemResponse): boolean {
  return Boolean(document.source_document_id) && isMarkdownDocument(document);
}

/**
 * 문서 하나의 변환 관계 배지. 관계가 없거나 아직 표시할 상태가 아니면 null(기존 확장자 배지 유지).
 * - 변환본 MD: 항상 "PDF→MD". 원본이 목록에 있으면 그 이름을, 없으면(삭제 등) 일반 문구를 설명으로 둔다.
 * - PDF 원본: 실패하지 않은 변환본이 있고 원본·변환본 모두 변환 중이 아닐 때만 체크를 붙인다.
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
      description: source ? `PDF에서 변환: ${source.filename}` : UNKNOWN_SOURCE_DESCRIPTION
    };
  }
  if (!isPdfDocument(document) || isDocumentConverting(document)) return null;
  const converted = documents.filter((item) =>
    item.source_document_id === document.id && isMarkdownDocument(item) && !isFailedConversion(item)
  );
  if (converted.length === 0 || converted.some(isDocumentConverting)) return null;
  return {
    label: CONVERTED_SOURCE_LABEL,
    isConverted: true,
    description: `Markdown으로 변환됨: ${converted.map((item) => item.filename).join(", ")}`
  };
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
