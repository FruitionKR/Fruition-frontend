import type { DocumentItemResponse } from "@/entities/document/model/document";

/** 원문 대체 사유 코드. 화면은 documents.preview.conversionReport.reasons.* 문구로 보여 준다. 모르는 코드는 unknown이다. */
export const FALLBACK_REASON_CODES = [
  "font_mapping",
  "replacement_character",
  "token_mismatch",
  "extract_failed",
  "repair_rejected",
  "provider_error"
] as const;

export type FallbackReason = (typeof FALLBACK_REASON_CODES)[number] | "unknown";

export function fallbackReason(code: string): FallbackReason {
  return (FALLBACK_REASON_CODES as readonly string[]).includes(code) ? code as FallbackReason : "unknown";
}

export type ConversionReportView = {
  /** 원문 텍스트로 대신한 쪽 수. 0이면 그 안내를 띄우지 않는다 */
  fallbackPageCount: number;
  /** 쪽 번호 순. reason은 대표 사유, causes는 대표 사유를 뺀 나머지 사유 */
  pages: { page: number; reason: FallbackReason; causes: FallbackReason[] }[];
  /** 그림 설명을 요청한 변환이면 집계, 아니면 null */
  figures: { described: number; failed: number; skipped: number } | null;
};

type ReportSource = Pick<DocumentItemResponse, "restoration_summary" | "figure_descriptions">;

/** 변환 문서 위에 띄울 복원·그림 설명 안내. 보여 줄 것이 없으면 null */
export function getConversionReportView(document: ReportSource | undefined): ConversionReportView | null {
  const fallbackPages = [...(document?.restoration_summary?.fallback_pages ?? [])].sort((a, b) => a.page - b.page);
  const figures = document?.figure_descriptions;
  const figureCounts = figures?.requested ? { described: figures.described, failed: figures.failed, skipped: figures.skipped } : null;
  if (fallbackPages.length === 0 && !figureCounts) return null;
  return {
    fallbackPageCount: fallbackPages.length,
    pages: fallbackPages.map(({ page, reason, causes = [] }) => ({
      page,
      reason: fallbackReason(reason),
      causes: [...new Set(causes.filter((cause) => cause !== reason).map(fallbackReason))]
    })),
    figures: figureCounts
  };
}
