import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting } from "@/entities/document/lib/documentKind";
import type { OperationLogItem } from "@/entities/operation-log/model/types";
import { OPERATION_TYPE_LABELS } from "@/entities/operation-log/model/operationType";

/** 사이드바 진행 작업 팝오버에 그릴 한 줄 */
export interface WikiWorkRow {
  key: string;
  label: string;
  /** 로컬 시각 HH:MM. 시작 시각이 없으면 --:-- */
  startTime: string;
}

/** 팝오버에서 나눠 보여주는 AI 작업 종류 */
export type WikiWorkKind = "ingest" | "lint" | "convert" | "restore";

export interface WikiWorkSection {
  kind: WikiWorkKind;
  title: string;
  rows: WikiWorkRow[];
}

export const WIKI_WORK_TITLES: Record<WikiWorkKind, string> = {
  ingest: OPERATION_TYPE_LABELS.ingest,
  lint: "위키 최신화",
  convert: "PDF → MD 변환",
  restore: "롤백"
};

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

function toRow(kind: WikiWorkKind, document: DocumentItemResponse): WikiWorkRow {
  return {
    key: `${kind}-${document.id}`,
    label: document.filename,
    startTime: formatWorkStartTime(document.processing_started_at)
  };
}

/**
 * 진행 중인 문서(selectActiveIngestDocuments로 거른 목록)와 lint·롤백 작업을
 * 위키 편입 / 위키 최신화 / PDF→MD 변환 / 롤백 네 구역으로 나눈다. 행이 없는 구역은 제외한다.
 */
export function buildWikiWorkSections(
  activeDocuments: DocumentItemResponse[],
  activeLint: OperationLogItem | null,
  activeRestores: OperationLogItem[] = []
): WikiWorkSection[] {
  const ingestRows: WikiWorkRow[] = [];
  const convertRows: WikiWorkRow[] = [];
  for (const document of activeDocuments) {
    // 변환 placeholder는 status processing + `convert:` run이다. 변환 후 자동 ingest는 다른 run id라 편입으로 분류된다.
    if (isDocumentConverting(document)) convertRows.push(toRow("convert", document));
    else ingestRows.push(toRow("ingest", document));
  }
  const lintRows: WikiWorkRow[] = activeLint
    ? [{ key: `lint-${activeLint.operation_id}`, label: "Wiki Lint", startTime: formatWorkStartTime(activeLint.created_at) }]
    : [];

  const restoreRows: WikiWorkRow[] = activeRestores.map((restore) => ({
    key: `restore-${restore.operation_id}`,
    label: restore.target_display_name || restore.summary || "롤백",
    startTime: formatWorkStartTime(restore.created_at)
  }));

  const sections: WikiWorkSection[] = [
    { kind: "ingest", title: WIKI_WORK_TITLES.ingest, rows: ingestRows },
    { kind: "lint", title: WIKI_WORK_TITLES.lint, rows: lintRows },
    { kind: "convert", title: WIKI_WORK_TITLES.convert, rows: convertRows },
    { kind: "restore", title: WIKI_WORK_TITLES.restore, rows: restoreRows }
  ];
  return sections.filter((section) => section.rows.length > 0);
}
