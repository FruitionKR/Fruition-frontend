import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting } from "@/entities/document/lib/documentKind";
import type { OperationLogItem } from "@/entities/operation-log/model/operationLog";
import { OPERATION_TYPE_LABELS } from "@/entities/operation-log/model/operationType";

/** 사이드바 진행 작업 팝오버에 그릴 한 줄 */
interface WikiWorkRow {
  key: string;
  label: string;
  /** 문서의 상위 폴더 경로. 같은 이름 문서를 구분한다. 최상위 문서·문서가 아닌 작업은 없다. */
  folderPath?: string;
  /** 로컬 시각 HH:MM. 시작 시각이 없으면 --:-- */
  startTime: string;
}

/** 팝오버에서 나눠 보여주는 AI 작업 종류 */
type WikiWorkKind = "ingest" | "lint" | "convert" | "restore";

interface WikiWorkSection {
  kind: WikiWorkKind;
  title: string;
  rows: WikiWorkRow[];
}

const WIKI_WORK_TITLES: Record<WikiWorkKind, string> = {
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

function toRow(kind: WikiWorkKind, document: DocumentItemResponse, folderPaths: ReadonlyMap<string, string>): WikiWorkRow {
  const folderPath = folderPaths.get(document.id);
  return {
    key: `${kind}-${document.id}`,
    label: document.filename,
    ...(folderPath ? { folderPath } : {}),
    startTime: formatWorkStartTime(document.processing_started_at)
  };
}

function startTimeValue(startedAt: string | undefined): number {
  const time = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** 최근에 시작한 작업이 위에 오도록 정렬한 사본을 돌려준다(Figma 1655:10162). 시각이 없으면 맨 아래. */
function sortNewestFirst<T>(items: T[], getStartedAt: (item: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const diff = startTimeValue(getStartedAt(b)) - startTimeValue(getStartedAt(a));
    return Number.isNaN(diff) ? 0 : diff;
  });
}

/**
 * 진행 중인 문서(selectActiveIngestDocuments로 거른 목록)와 lint·롤백 작업을
 * 위키 편입 / 위키 최신화 / PDF→MD 변환 / 롤백 네 구역으로 나눈다. 행이 없는 구역은 제외한다.
 * 각 구역 안에서는 최근에 시작한 작업이 위에 온다. folderPaths(문서 id → 상위 폴더 경로)가 있으면 문서 행에 붙인다.
 */
export function buildWikiWorkSections(
  activeDocuments: DocumentItemResponse[],
  activeLint: OperationLogItem | null,
  activeRestores: OperationLogItem[] = [],
  folderPaths: ReadonlyMap<string, string> = new Map()
): WikiWorkSection[] {
  const ingestRows: WikiWorkRow[] = [];
  const convertRows: WikiWorkRow[] = [];
  for (const document of sortNewestFirst(activeDocuments, (item) => item.processing_started_at)) {
    // 변환 placeholder는 status processing + `convert:` run이다. 변환 후 자동 ingest는 다른 run id라 편입으로 분류된다.
    if (isDocumentConverting(document)) convertRows.push(toRow("convert", document, folderPaths));
    else ingestRows.push(toRow("ingest", document, folderPaths));
  }
  const lintRows: WikiWorkRow[] = activeLint
    ? [{ key: `lint-${activeLint.operation_id}`, label: "위키 최신화", startTime: formatWorkStartTime(activeLint.created_at) }]
    : [];

  const restoreRows: WikiWorkRow[] = sortNewestFirst(activeRestores, (item) => item.created_at).map((restore) => ({
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
