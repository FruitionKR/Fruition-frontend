import type { AiModel } from "./aiModel";

export type AiUsagePeriod = "this_month" | "last_30_days" | "last_month";

export const AI_USAGE_PERIOD_OPTIONS: ReadonlyArray<{ value: AiUsagePeriod; label: string }> = [
  { value: "this_month", label: "이번 달" },
  { value: "last_30_days", label: "지난 30일" },
  { value: "last_month", label: "지난 달" }
];

export type UsageRange = { from: Date; to: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * 기간을 [from, to) 시각으로 바꾼다. 달 경계는 사용자 기기 시간대 기준이다.
 * 끝 시각은 지금이 속한 분의 다음 분 정각이다. 같은 분 안에서는 범위가 같아 금액 조회 키가 매번 바뀌지 않고,
 * 방금 쓴 사용량도 바로 들어간다. 지금보다 늘 뒤라 매달 1일 0시 첫 1분에도 이번 달 범위가 비지 않는다(시작 = 끝이면 400).
 * 달 경계는 올린 끝 시각이 아니라 지금 시각으로 정한다. 말일 23:59에 이번 달이 다음 달로 넘어가지 않게 한다.
 * 서버(document 금액 조회)는 시작 < 끝과 366일 이하만 확인하고 미래의 끝 시각을 거절하지 않는다.
 */
export function resolveUsageRange(period: AiUsagePeriod, at: Date): UsageRange {
  const end = new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  const monthStart = new Date(at.getFullYear(), at.getMonth(), 1);
  if (period === "last_month") {
    return { from: new Date(at.getFullYear(), at.getMonth() - 1, 1), to: monthStart };
  }
  if (period === "last_30_days") {
    return { from: new Date(end.getTime() - 30 * DAY_MS), to: end };
  }
  return { from: monthStart, to: end };
}

export type ModelUsageSummaryRow = {
  key: string;
  label: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** 음성 길이(초). 전사 호출은 토큰과 함께 남을 수 있다 */
  audioSeconds: number;
  /** TTS 입력 글자 수 */
  ttsCharacters: number;
  /** 부가세 포함 실제 청구(milli-KRW) */
  chargeKrwMilli: number;
  unpricedCalls: number;
};

export type ModelUsageSummary = {
  models: ModelUsageSummaryRow[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 기간 안 전체 호출 수 */
  calls: number;
  /** 응답 최상위의 실제 청구 합계(milli-KRW). 토큰 없이 음성·글자로 매긴 금액도 들어 있다 */
  chargeKrwMilli: number;
  /** 단가·환율·정책이 없어 금액에 빠진 호출 수 */
  unpricedCalls: number;
  /** 사용량을 몰라 0원으로 둔 호출 수 */
  needsReviewCalls: number;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 공급사 스냅샷·버전 접미사: -YYYY-MM-DD, -YYYYMMDD, -NNN, -latest (백엔드 model_routing의 snapshot 판정과 같은 형식) */
const MODEL_VERSION_SUFFIX = /-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{3}|latest)$/;

/** 카탈로그에서 응답 모델을 찾는다. 이름이 그대로 있으면 그 항목을, 없으면 접미사를 뗀 이름을 쓴다. */
function findCatalogModel(catalog: readonly AiModel[], provider: string, model: string): AiModel | undefined {
  const find = (id: string) => catalog.find((item) => item.provider === provider && item.model === id);
  return find(model) ?? find(model.replace(MODEL_VERSION_SUFFIX, ""));
}

function hasUsage(row: ModelChargeRow): boolean {
  return [row.calls, row.input_tokens, row.output_tokens, row.audio_seconds, row.tts_characters, row.charge_krw_milli]
    .some((value) => count(value) > 0);
}

/**
 * 청구 응답을 화면 표 줄로 묶는다. 카탈로그에서 같은 모델로 찾아진 스냅샷 줄(gpt-…-2025-08-07 등)은 한 줄로 합치고 display_name을 쓴다.
 * 못 찾으면 모델 id를 그대로 보이고 합치지 않는다. 토큰이 큰 순서이고, 토큰이 같으면(음성·TTS 줄) 금액이 큰 순서다.
 * 토큰이 0이어도 호출·음성·글자·금액 중 하나가 있으면 줄을 남긴다. 합계 금액과 안내 건수는 응답 최상위 값을 쓴다.
 */
export function summarizeModelUsage(charges: ChargeSummaryResponse, catalog: readonly AiModel[]): ModelUsageSummary {
  const grouped = new Map<string, ModelUsageSummaryRow>();
  let calls = 0;
  for (const row of charges.models) {
    if (!hasUsage(row)) continue;
    const matched = findCatalogModel(catalog, row.provider, row.model);
    const key = `${row.provider}/${matched?.model ?? row.model}`;
    const current = grouped.get(key) ?? {
      key,
      label: matched?.display_name ?? row.model,
      provider: row.provider,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      audioSeconds: 0,
      ttsCharacters: 0,
      chargeKrwMilli: 0,
      unpricedCalls: 0
    };
    const inputTokens = current.inputTokens + count(row.input_tokens);
    const outputTokens = current.outputTokens + count(row.output_tokens);
    grouped.set(key, {
      ...current,
      inputTokens,
      outputTokens,
      cachedInputTokens: current.cachedInputTokens + count(row.cached_input_tokens),
      totalTokens: inputTokens + outputTokens,
      audioSeconds: current.audioSeconds + count(row.audio_seconds),
      ttsCharacters: current.ttsCharacters + count(row.tts_characters),
      chargeKrwMilli: current.chargeKrwMilli + count(row.charge_krw_milli),
      unpricedCalls: current.unpricedCalls + count(row.unpriced_calls)
    });
    calls += count(row.calls);
  }
  const models = Array.from(grouped.values()).sort((a, b) =>
    b.totalTokens - a.totalTokens || b.chargeKrwMilli - a.chargeKrwMilli || a.label.localeCompare(b.label, "ko"));
  const inputTokens = models.reduce((sum, item) => sum + item.inputTokens, 0);
  const outputTokens = models.reduce((sum, item) => sum + item.outputTokens, 0);
  return {
    models,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    calls,
    chargeKrwMilli: count(charges.charge_krw_milli),
    unpricedCalls: count(charges.unpriced_calls),
    needsReviewCalls: count(charges.needs_review_calls)
  };
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

/** 본인 호출 청구 합계. 참여한 모든 워크스페이스를 가로질러 합친 값이다. */
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

const KRW_FORMAT = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });

/**
 * milli-KRW 금액을 원 단위로 반올림해 보인다(1,240,400 → ₩1,240). 0은 ₩0, 0원 초과 1원 미만(milli-KRW 1~499)은 "₩1 미만"이다.
 * 원화는 소수 자리를 쓰지 않으므로 작은 금액도 소수로 늘이지 않는다.
 */
export function formatKrwMilli(value: number): string {
  const safe = count(value);
  if (safe > 0 && safe < 500) return `${KRW_FORMAT.format(1)} 미만`;
  return KRW_FORMAT.format(Math.round(safe / 1000));
}

/** 청구 금액 문구. 단가 없는 호출만 있어 0원이면 실제 0원과 구분하도록 null이다. */
export function formatKnownCharge(chargeKrwMilli: number, unpricedCalls: number): string | null {
  return count(chargeKrwMilli) === 0 && unpricedCalls > 0 ? null : formatKrwMilli(chargeKrwMilli);
}

function formatAudioDuration(seconds: number): string {
  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest}초`;
  return rest === 0 ? `${formatTokenCount(minutes)}분` : `${formatTokenCount(minutes)}분 ${rest}초`;
}

/** 토큰 밖 사용량 문구(음성 2분 5초 · 1,800자). 없으면 null이다. */
export function formatNonTokenUsage({ audioSeconds, ttsCharacters }: Pick<ModelUsageSummaryRow, "audioSeconds" | "ttsCharacters">): string | null {
  const parts = [
    audioSeconds > 0 ? `음성 ${formatAudioDuration(audioSeconds)}` : null,
    ttsCharacters > 0 ? `${formatTokenCount(ttsCharacters)}자` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
