import type { DocumentUploadResponse } from "@/entities/document/model/document";

/** 업로드는 됐지만 서버가 자동 위키 편입을 건너뛰어 사용자에게 알릴 사유. */
export const WIKI_INGEST_SKIP_REASONS = ["INSUFFICIENT_CREDIT", "AI_USAGE_LIMIT_EXCEEDED", "ERROR"] as const;
export type WikiIngestSkipReason = (typeof WIKI_INGEST_SKIP_REASONS)[number];

/**
 * 업로드 응답의 wiki_ingest가 SKIPPED이고 알릴 사유면 그 사유, 아니면 null.
 * 필드가 없거나(구 서버·멱등 재생·가져오기 세션) 모르는 status·reason이면 null이다.
 * DISABLED(편입 설정 꺼짐)·PERMISSION(편입 권한 없음)·사유 없음은 사용자가 따로 할 일이 없어 알리지 않는다.
 */
export function parseWikiIngestSkip(response: Pick<DocumentUploadResponse, "wiki_ingest">): WikiIngestSkipReason | null {
  const ingest = response.wiki_ingest;
  if (!ingest || typeof ingest !== "object" || ingest.status !== "SKIPPED") return null;
  return WIKI_INGEST_SKIP_REASONS.find((reason) => reason === ingest.reason) ?? null;
}

/** 묶음 업로드 요약에 붙일 사유별 건수. 사유 순서는 WIKI_INGEST_SKIP_REASONS를 따른다. */
export function countWikiIngestSkips(responses: readonly (Pick<DocumentUploadResponse, "wiki_ingest"> | null)[]): { reason: WikiIngestSkipReason; count: number }[] {
  const reasons = responses.flatMap((response) => {
    const reason = response && parseWikiIngestSkip(response);
    return reason ? [reason] : [];
  });
  return WIKI_INGEST_SKIP_REASONS
    .map((reason) => ({ reason, count: reasons.filter((item) => item === reason).length }))
    .filter(({ count }) => count > 0);
}
