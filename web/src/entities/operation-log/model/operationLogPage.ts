import type { OperationLogItem, OperationType } from "./operationLog";
import { isServerLintDisplayName, localizeOperationSummary, type OperationSummaryTranslate } from "./operationSummary";

type OperationLogDateGroup = {
  dateKey: string;
  label: string;
  items: OperationLogItem[];
};

/**
 * Figma 로그 사이드바처럼 최신순 작업을 사용자의 날짜 기준으로 묶는다.
 * locale(화면 언어, 기본 한국어)로 그룹 이름("9월 23일" / "September 23")을 쓴다. 묶는 기준은 언어와 관계없다.
 */
export function groupOperationLogsByDate(
  items: OperationLogItem[],
  timeZone?: string,
  locale = "ko-KR"
): OperationLogDateGroup[] {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone
  });
  const labelFormatter = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone });
  const groups: OperationLogDateGroup[] = [];

  for (const item of items) {
    const parts = formatter.formatToParts(new Date(item.created_at));
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    const dateKey = `${year}-${month}-${day}`;
    const current = groups.at(-1);
    if (current?.dateKey === dateKey) {
      current.items.push(item);
    } else {
      groups.push({ dateKey, label: labelFormatter.format(new Date(item.created_at)), items: [item] });
    }
  }

  return groups;
}

/** 실제 바꾼 문서 없이 성공으로 끝난 lint 작업은 로그 목록에 노출하지 않는다. */
export function filterVisibleOperationLogs(items: OperationLogItem[]): OperationLogItem[] {
  return items.filter(
    (item) => !(
      item.operation_type === "lint" &&
      item.status === "succeeded" &&
      item.changed_resource_count === 0
    )
  );
}

/** 로그 화면 유형 탭. 유형을 고르지 않으면(전체) 목록을 그대로 돌려준다. */
export function filterOperationLogsByType(
  items: OperationLogItem[],
  type: OperationType | null
): OperationLogItem[] {
  return type ? items.filter((item) => item.operation_type === type) : items;
}

/** 로그 행 앞머리 시각. Figma "Sep 23, 9:52 AM"을 화면 언어 표기(한국어면 "9월 23일 오전 9:52")로 쓴다. */
export function formatOperationLogDateTime(iso: string, timeZone?: string, locale = "ko-KR"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone
  }).format(new Date(iso));
}

/**
 * 목록과 상세 헤더가 같은 문서·작업 설명을 사용한다.
 * tSummary(`useTranslations("workspace.logMessages.summary")`)를 넘기면 서버가 한국어로 저장한 알려진 요약을 지금 언어로 쓴다.
 */
export function formatOperationLogDescription(
  item: Partial<Pick<OperationLogItem, "operation_type" | "status" | "changed_resource_count">> & Pick<OperationLogItem, "summary">,
  documentTitle?: string,
  /** 문서 이름·요약이 모두 없을 때 문구. 화면은 workspace.logMessages.noDetail을 넘긴다. */
  emptyText = "상세 정보 없음",
  tSummary?: OperationSummaryTranslate
): string {
  const rawSummary = item.summary?.trim();
  const summary = item.operation_type && tSummary
    ? localizeOperationSummary({
      operation_type: item.operation_type,
      status: item.status ?? "",
      summary: item.summary,
      changed_resource_count: item.changed_resource_count ?? 0
    }, tSummary) ?? undefined
    : rawSummary;
  // lint의 대상 이름은 서버가 붙인 한국어 작업 이름이라 문서 이름으로 쓰지 않는다(행 제목이 작업 종류를 이미 보인다).
  const title = tSummary && isServerLintDisplayName(item.operation_type, documentTitle) ? undefined : documentTitle;
  if (title && summary && rawSummary !== title) {
    return `${title} / ${summary}`;
  }
  return title ?? summary ?? emptyText;
}

/**
 * 최신순 로그 목록의 다음 페이지를 이어붙인다.
 * 커서 경계에서 같은 operation_id가 다시 오면 한 번만 남긴다.
 */
export function appendLogPage(
  previous: OperationLogItem[],
  incoming: OperationLogItem[]
): OperationLogItem[] {
  const seen = new Set(previous.map((item) => item.operation_id));
  const added = incoming.filter((item) => !seen.has(item.operation_id));
  return added.length ? [...previous, ...added] : previous;
}

/** 최신 첫 페이지를 갱신하되 사용자가 이미 불러온 이전 페이지는 뒤에 보존한다. */
export function mergeRefreshedLogPage(
  previous: OperationLogItem[],
  refreshed: OperationLogItem[]
): OperationLogItem[] {
  const refreshedIds = new Set(refreshed.map((item) => item.operation_id));
  const retained = previous.filter((item) => !refreshedIds.has(item.operation_id));
  return [...refreshed, ...retained];
}

/**
 * 목록에서 상세로 띄울 작업 하나를 고른다.
 * 사용자가 고른 작업이 목록에 남아 있을 때만 유지하고, 아니면 아무것도 고르지 않는다(첫 행 자동 선택 없음).
 */
export function pickSelectedOperationId(
  items: OperationLogItem[],
  current: string | null
): string | null {
  return current && items.some((item) => item.operation_id === current) ? current : null;
}

export function collectRestoredOperationIds(items: OperationLogItem[]): ReadonlySet<string> {
  return new Set(items.flatMap((item) => item.restored_from ? [item.restored_from] : []));
}
