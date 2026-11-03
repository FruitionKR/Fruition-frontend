import type { DocumentItemResponse } from "@/entities/document/model/document";

/** 원문 대체 사유 코드의 화면 문구 */
export const FALLBACK_REASON_LABELS: Record<string, string> = {
  font_mapping: "글꼴을 읽지 못함",
  replacement_character: "깨진 글자가 있음",
  token_mismatch: "표·수식 위치가 맞지 않음",
  extract_failed: "글자를 뽑지 못함",
  repair_rejected: "AI 복원 결과가 원문과 달라 사용하지 않음",
  provider_error: "AI 복원 요청 실패"
};

const UNKNOWN_REASON_LABEL = "알 수 없는 이유";

export function fallbackReasonLabel(code: string): string {
  return FALLBACK_REASON_LABELS[code] ?? UNKNOWN_REASON_LABEL;
}

export type ConversionReportView = {
  /** "3개 페이지는 원문 텍스트로 대신했어요". 대신한 쪽이 없으면 null */
  fallbackTitle: string | null;
  /** 쪽 번호 순. reason은 대표 사유, causes는 대표 사유를 뺀 나머지 사유 문구 */
  pages: { page: number; reason: string; causes: string[] }[];
  /** 그림 설명을 요청한 변환이면 집계 문구, 아니면 null */
  figures: string | null;
};

type ReportSource = Pick<DocumentItemResponse, "restoration_summary" | "figure_descriptions">;

/** 변환 문서 위에 띄울 복원·그림 설명 안내. 보여 줄 것이 없으면 null */
export function getConversionReportView(document: ReportSource | undefined): ConversionReportView | null {
  const fallbackPages = [...(document?.restoration_summary?.fallback_pages ?? [])].sort((a, b) => a.page - b.page);
  const figures = document?.figure_descriptions;
  const figureText = figures?.requested ? describeFigures(figures) : null;
  if (fallbackPages.length === 0 && !figureText) return null;
  return {
    fallbackTitle: fallbackPages.length > 0 ? `${fallbackPages.length}개 페이지는 원문 텍스트로 대신했어요` : null,
    pages: fallbackPages.map(({ page, reason, causes = [] }) => ({
      page,
      reason: fallbackReasonLabel(reason),
      causes: [...new Set(causes.filter((cause) => cause !== reason).map(fallbackReasonLabel))]
    })),
    figures: figureText
  };
}

function describeFigures({ described, failed, skipped }: { described: number; failed: number; skipped: number }): string {
  const parts = [`그림 ${described}개에 설명을 붙였어요`];
  if (failed > 0) parts.push(`${failed}개 실패`);
  if (skipped > 0) parts.push(`${skipped}개는 건너뜀`);
  return parts.join(" · ");
}
