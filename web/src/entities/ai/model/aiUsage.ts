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
  /** 기간 안 전체 호출 수(실패·사용량 미확인 포함) */
  calls: number;
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
  let calls = 0;
  for (const row of rows) {
    const modelId = row.requested_model || row.model;
    const key = summaryKey(row);
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
    calls += count(row.calls);
  }
  const models = Array.from(grouped.values())
    .filter((item) => item.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label, "ko"));
  const inputTokens = models.reduce((sum, item) => sum + item.inputTokens, 0);
  const outputTokens = models.reduce((sum, item) => sum + item.outputTokens, 0);
  return { models, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, calls, unknownUsageCalls };
}

/** 화면 표 한 줄의 키. 같은 요청 모델의 스냅샷 줄을 합친다(summarizeModelUsage·estimateUsageCost가 같이 쓴다). */
function summaryKey(row: Pick<ModelUsageRow, "provider" | "requested_model" | "model">): string {
  return `${row.provider}/${row.requested_model || row.model}`;
}

function catalogLabel(catalog: readonly AiModel[], provider: string, model: string): string | undefined {
  return catalog.find((item) => item.provider === provider && item.model === model)?.display_name;
}

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

/** 토큰 수를 천 단위 구분 기호로 보인다. */
export function formatTokenCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

const COMPACT_FORMAT = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
const COMPACT_FROM = 10_000;

/** 큰 토큰 수를 만·억 단위로 줄인다(78,257 → 7.8만). 1만 미만은 줄이지 않고 천 단위 구분 기호로 보인다. */
export function formatCompactTokenCount(value: number): string {
  return value < COMPACT_FROM ? formatTokenCount(value) : COMPACT_FORMAT.format(value);
}

/**
 * 값들의 비율을 합이 정확히 100인 정수 %로 나눈다(최대 나머지 방식). 합이 0이면 모두 0이다.
 * 반올림만 하면 33·33·33처럼 합이 99나 101이 되어 막대와 숫자가 어긋난다.
 */
export function toPercentShares(values: readonly number[]): number[] {
  const safe = values.map(count);
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total === 0) return safe.map(() => 0);
  const exact = safe.map((value) => (value / total) * 100);
  const shares = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const missing = 100 - shares.reduce((sum, value) => sum + value, 0);
  const bumped = new Set(order.slice(0, missing).map((item) => item.index));
  return shares.map((share, index) => (bumped.has(index) ? share + 1 : share));
}

/** 정수 % 문구. 0이 아닌 값이 0%로 반올림되면 "<1%"로 보인다. */
export function formatPercentShare(share: number, value: number): string {
  return share === 0 && value > 0 ? "<1%" : `${share}%`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

/** 표 캡션의 기간 문구. to는 포함하지 않으므로 하루 전 날짜를 끝으로 보이되, 지금까지(to가 자정이 아님)면 그날이다. */
export function formatUsageRange({ from, to }: UsageRange): string {
  const isMidnight = to.getHours() === 0 && to.getMinutes() === 0 && to.getSeconds() === 0 && to.getMilliseconds() === 0;
  const last = isMidnight ? new Date(to.getTime() - 1) : to;
  return `${DATE_FORMAT.format(from)} ~ ${DATE_FORMAT.format(last)}`;
}

/**
 * GET /api/users/me/usage/charges 응답의 모델 한 줄. 응답 모델(`model`)별로 묶인 실제 청구다.
 * 금액은 부가세 포함 milli-KRW 정수(1000 = 1원)이고, 토큰에는 단가 없는(unpriced) 호출의 토큰도 들어 있다.
 */
export type ModelChargeRow = {
  provider: string;
  model: string;
  calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  audio_seconds: number;
  tts_characters: number;
  charge_krw_milli: number;
  /** 단가·환율·정책이 없어 금액에 빠진 호출 수 */
  unpriced_calls: number;
  /** 사용량을 몰라 0원으로 둔 호출 수 */
  needs_review_calls: number;
};

/** 본인 호출 청구 합계. 워크스페이스를 가로질러 합친 값이라 워크스페이스로 거를 수 없다. */
export type ChargeSummaryResponse = {
  user_id: string;
  from_at: string;
  to_at: string;
  currency: string;
  charge_krw_milli: number;
  unpriced_calls: number;
  needs_review_calls: number;
  models: ModelChargeRow[];
};

export type UsageCostEstimate = {
  /** 표 줄 키 → 이 워크스페이스 예상 금액(milli-KRW). 단가를 아직 모르면 null */
  models: Record<string, number | null>;
  /** 이 워크스페이스 예상 합계(milli-KRW). 단가를 아는 모델만 더한다 */
  totalKrwMilli: number;
  /** 모든 워크스페이스 합산 실제 청구(milli-KRW). 음성 초·글자 수로 매긴 금액도 들어 있다 */
  accountKrwMilli: number;
  /** 단가가 없거나 아직 청구가 집계되지 않아 예상에서 빠진 사용량이 있다 */
  hasUnpriced: boolean;
  /**
   * 예상이 실제 청구를 넘어 청구액으로 낮췄다. 사용량 집계가 청구 집계보다 앞서(청구 반영 지연)
   * 이 워크스페이스 사용량이 모든 워크스페이스 청구보다 커 보일 때다.
   */
  isCapped: boolean;
};

/**
 * 이 워크스페이스 토큰에 모델별 평균 단가(청구 금액 ÷ 청구 토큰)를 곱해 예상 금액을 만든다.
 * 청구는 워크스페이스를 가로질러 합쳐 오므로 같은 응답 모델(provider + model)의 평균 단가를 빌려 쓴다.
 * 입력·출력 비율이 워크스페이스마다 다르면 실제와 조금 다를 수 있어 "예상"이다.
 * 모든 호출이 단가 없음이거나, 토큰 없이 음성·글자로만 매겨진 줄, 아직 청구가 집계되지 않은 모델은 평균 단가를 만들 수 없다.
 *
 * 사용량(usage/models)은 청구(usage/charges)보다 먼저 집계돼, 아직 청구되지 않은 호출까지 세면 예상이 실제 청구를 넘을 수 있다.
 * 한 워크스페이스 몫은 모든 워크스페이스 청구를 넘을 수 없으므로, 응답 모델별 예상은 그 모델의 청구액까지,
 * 합계는 전체 청구액까지 비율을 유지한 채 낮추고 isCapped로 알린다.
 */
export function estimateUsageCost(rows: readonly ModelUsageRow[], charges: ChargeSummaryResponse): UsageCostEstimate {
  const rates = new Map<string, { rate: number; chargedKrwMilli: number }>();
  let hasUnpriced = false;
  for (const charge of charges.models ?? []) {
    const tokens = count(charge.input_tokens) + count(charge.output_tokens);
    const calls = count(charge.calls);
    const unpriced = count(charge.unpriced_calls);
    if (unpriced > 0) hasUnpriced = true;
    if (tokens > 0 && unpriced < calls) {
      const chargedKrwMilli = count(charge.charge_krw_milli);
      rates.set(`${charge.provider}/${charge.model}`, { rate: chargedKrwMilli / tokens, chargedKrwMilli });
    }
  }
  // 응답 모델(단가 키)별 예상과, 그 예상이 들어갈 표 줄 키별 몫
  const contributions: { key: string; rateKey: string; amount: number }[] = [];
  const models: Record<string, number | null> = {};
  for (const row of rows) {
    const tokens = count(row.known_input_tokens) + count(row.known_output_tokens);
    if (tokens === 0) continue;
    const key = summaryKey(row);
    const rateKey = `${row.provider}/${row.model}`;
    const priced = rates.get(rateKey);
    if (priced === undefined) {
      hasUnpriced = true;
      models[key] = models[key] ?? null;
      continue;
    }
    contributions.push({ key, rateKey, amount: tokens * priced.rate });
  }
  let isCapped = false;
  const estimatedByRate = new Map<string, number>();
  for (const { rateKey, amount } of contributions) estimatedByRate.set(rateKey, (estimatedByRate.get(rateKey) ?? 0) + amount);
  for (const { key, rateKey, amount } of contributions) {
    const estimated = estimatedByRate.get(rateKey) ?? 0;
    const charged = rates.get(rateKey)?.chargedKrwMilli ?? 0;
    const scale = estimated > charged ? charged / estimated : 1;
    if (scale < 1) isCapped = true;
    models[key] = (models[key] ?? 0) + amount * scale;
  }
  const accountKrwMilli = count(charges.charge_krw_milli);
  const estimatedTotal = Object.values(models).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (estimatedTotal > accountKrwMilli) {
    isCapped = true;
    const scale = estimatedTotal > 0 ? accountKrwMilli / estimatedTotal : 0;
    for (const key of Object.keys(models)) {
      const value = models[key];
      if (value !== null) models[key] = value * scale;
    }
  }
  const totalKrwMilli = Math.min(estimatedTotal, accountKrwMilli);
  return { models, totalKrwMilli, accountKrwMilli, hasUnpriced, isCapped };
}

const KRW_FORMAT = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });

/**
 * milli-KRW 금액을 원 단위로 반올림해 보인다(1,240,400 → ₩1,240). 0은 ₩0, 0원 초과 1원 미만은 "<₩1"이다.
 * 원화는 소수 자리를 쓰지 않으므로 작은 금액도 소수로 늘이지 않는다.
 */
export function formatKrwMilli(value: number): string {
  const safe = count(value);
  if (safe > 0 && safe < 500) return `<${KRW_FORMAT.format(1)}`;
  return KRW_FORMAT.format(Math.round(safe / 1000));
}

/** 두 milli-KRW 금액이 원 단위로 반올림했을 때 같은지 */
export function isSameWon(a: number, b: number): boolean {
  return Math.round(count(a) / 1000) === Math.round(count(b) / 1000);
}
