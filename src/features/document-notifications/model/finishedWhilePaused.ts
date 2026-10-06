import type { DocumentItemResponse } from "@/entities/document/model/document";

function processedTime(document: Pick<DocumentItemResponse, "processed_at">): number {
  return document.processed_at ? Date.parse(document.processed_at) : Number.NaN;
}

/**
 * 목록에서 가장 늦은 processed_at(서버 시각). 없으면 null.
 * 숨김 탭 폴링이 멈출 때의 기준점으로 쓴다. 클라이언트 시각 대신 서버 시각끼리 비교해 시계 오차를 피한다.
 */
export function latestProcessedAt(documents: Pick<DocumentItemResponse, "processed_at">[]): number | null {
  let latest: number | null = null;
  for (const document of documents) {
    const time = processedTime(document);
    if (Number.isFinite(time) && (latest === null || time > latest)) latest = time;
  }
  return latest;
}

/**
 * 기준점 이후 파이프라인 처리를 마친 문서인지. 폴링이 멈춘 동안 시작·종결돼 처리 중 상태를 보지 못한 문서를 잡는다.
 * 직접 생성한 Markdown·복제본은 processing_started_at 없이 completed가 되므로 제외된다.
 */
export function hasFinishedSince(
  document: Pick<DocumentItemResponse, "status" | "processed_at" | "processing_started_at">,
  baseline: number
): boolean {
  if (document.status !== "completed" && document.status !== "failed") return false;
  if (!document.processing_started_at) return false;
  return processedTime(document) > baseline;
}
