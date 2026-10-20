import type { AiModel } from "./aiModel";

/**
 * GET /api/workspaces/{workspace_id}/usage/models 응답의 모델 한 줄.
 * document가 ai `/usage/models` 응답을 그대로 돌려준다(provider·requested_model·model 묶음별 집계).
 * 캐시(cached_input)는 입력의, 추론(reasoning)은 출력의 부분 집합이라 합계에 따로 더하지 않는다.
 */
export type ModelUsageRow = {
  provider: string;
  requested_model: string;
  model: string;
  calls: number;
  failed_calls: number;
  unfinished_calls: number;
  /** 공급사가 입력·출력 토큰을 주지 않아 합계에 빠진 호출 수 */
  unknown_usage_calls: number;
  known_input_tokens: number;
  known_output_tokens: number;
  known_cached_input_tokens: number;
  known_cache_creation_tokens: number;
  known_reasoning_tokens: number;
  unknown_cache_usage_calls: number;
};

export type ModelUsageResponse = {
  workspace_id: string;
  user_id: string;
  from_at: string;
  to_at: string;
  models: ModelUsageRow[];
};

export type AiUsagePeriod = "this_month" | "last_30_days" | "last_month";

export const AI_USAGE_PERIOD_OPTIONS: ReadonlyArray<{ value: AiUsagePeriod; label: string }> = [
  { value: "this_month", label: "이번 달" },
  { value: "last_30_days", label: "지난 30일" },
  { value: "last_month", label: "지난 달" }
];

export type UsageRange = { from: Date; to: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/** 기간을 [from, to) 시각으로 바꾼다. 달 경계는 사용자 기기 시간대 기준이다(백엔드 기본값은 UTC 이번 달). */
export function resolveUsageRange(period: AiUsagePeriod, now: Date): UsageRange {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "last_month") {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: monthStart };
  }
  if (period === "last_30_days") {
    return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  }
  return { from: monthStart, to: now };
}

export type ModelUsageSummaryRow = {
  key: string;
  label: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
};

export type ModelUsageSummary = {
  models: ModelUsageSummaryRow[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 토큰을 몰라 합계에 빠진 호출 수 */
  unknownUsageCalls: number;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 응답 줄을 화면 표 줄로 묶는다. 같은 요청 모델은 응답 모델 스냅샷 이름(gpt-…-2025-08-07 등)이 달라도 한 줄로 합친다.
 * 이름은 카탈로그 display_name(요청 모델 → 응답 모델 순)을 쓰고, 없으면 모델 id를 그대로 보인다. 합계가 큰 순서다.
 */
export function summarizeModelUsage(rows: readonly ModelUsageRow[], catalog: readonly AiModel[]): ModelUsageSummary {
  const grouped = new Map<string, ModelUsageSummaryRow>();
  let unknownUsageCalls = 0;
  for (const row of rows) {
    const modelId = row.requested_model || row.model;
    const key = `${row.provider}/${modelId}`;
    const current = grouped.get(key) ?? {
      key,
      label: catalogLabel(catalog, row.provider, modelId) ?? catalogLabel(catalog, row.provider, row.model) ?? modelId,
      provider: row.provider,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0
    };
    const inputTokens = current.inputTokens + count(row.known_input_tokens);
    const outputTokens = current.outputTokens + count(row.known_output_tokens);
    grouped.set(key, {
      ...current,
      inputTokens,
      outputTokens,
      cachedInputTokens: current.cachedInputTokens + count(row.known_cached_input_tokens),
      totalTokens: inputTokens + outputTokens
    });
    unknownUsageCalls += count(row.unknown_usage_calls);
  }
  const models = Array.from(grouped.values())
    .filter((item) => item.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label, "ko"));
  const inputTokens = models.reduce((sum, item) => sum + item.inputTokens, 0);
  const outputTokens = models.reduce((sum, item) => sum + item.outputTokens, 0);
  return { models, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, unknownUsageCalls };
}

function catalogLabel(catalog: readonly AiModel[], provider: string, model: string): string | undefined {
  return catalog.find((item) => item.provider === provider && item.model === model)?.display_name;
}

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

/** 토큰 수를 천 단위 구분 기호로 보인다. */
export function formatTokenCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

/** 표 캡션의 기간 문구. to는 포함하지 않으므로 하루 전 날짜를 끝으로 보이되, 지금까지(to가 자정이 아님)면 그날이다. */
export function formatUsageRange({ from, to }: UsageRange): string {
  const isMidnight = to.getHours() === 0 && to.getMinutes() === 0 && to.getSeconds() === 0 && to.getMilliseconds() === 0;
  const last = isMidnight ? new Date(to.getTime() - 1) : to;
  return `${DATE_FORMAT.format(from)} ~ ${DATE_FORMAT.format(last)}`;
}
