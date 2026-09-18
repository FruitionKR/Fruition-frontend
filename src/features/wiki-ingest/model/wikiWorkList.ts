import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { OperationLogItem } from "@/entities/operation-log/model/types";

/** 사이드바 진행 작업 팝오버에 그릴 한 줄 */
export interface WikiWorkRow {
  key: string;
  label: string;
  /** 로컬 시각 HH:MM. 시작 시각이 없으면 --:-- */
  startTime: string;
}

const UNKNOWN_TIME = "--:--";

/** ISO 시각을 로컬 24시간제 HH:MM으로 만든다. 값이 없거나 깨졌으면 --:--. */
export function formatWorkStartTime(startedAt: string | undefined): string {
  if (!startedAt) return UNKNOWN_TIME;
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return UNKNOWN_TIME;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * 진행 중인 ingest 문서(selectActiveIngestDocuments로 거른 목록)와 lint 작업을 팝오버 행으로 바꾼다.
 * 아무것도 없으면 빈 배열.
 */
export function buildWikiWorkRows(
  activeDocuments: DocumentItemResponse[],
  activeLint: OperationLogItem | null
): WikiWorkRow[] {
  const ingestRows = activeDocuments.map((document) => ({
    key: `ingest-${document.id}`,
    label: document.filename,
    startTime: formatWorkStartTime(document.processing_started_at)
  }));
  if (!activeLint) return ingestRows;
  return [
    ...ingestRows,
    { key: `lint-${activeLint.operation_id}`, label: "Wiki Lint", startTime: formatWorkStartTime(activeLint.created_at) }
  ];
}
