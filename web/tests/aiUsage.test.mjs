import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompactTokenCount,
  formatKnownCharge,
  formatKrwMilli,
  formatNonTokenUsage,
  formatPercentShare,
  formatTokenCount,
  formatUsageRange,
  usageRefetchInterval,
  AI_USAGE_REFETCH_INTERVAL_MS,
  resolveUsageRange,
  summarizeModelUsage,
  toPercentShares
} from "../src/entities/ai/model/aiUsage.ts";
import { LOCKED_AI_MODELS } from "../src/entities/ai/model/lockedAiModels.ts";

const CATALOG = [
  { provider: "openai", model: "gpt-6-luna", display_name: "GPT-6 Luna" },
  { provider: "openai", model: "gpt-5-nano", display_name: "GPT-5 Nano" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", display_name: "Gemini 3.5 Flash-Lite" }
];

function charge(overrides) {
  return {
    provider: "openai", model: "gpt-6-luna", calls: 1, input_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0,
    output_tokens: 0, reasoning_tokens: 0, audio_seconds: 0, tts_characters: 0, charge_krw_milli: 0,
    unpriced_calls: 0, needs_review_calls: 0, ...overrides
  };
}

function charges(models, overrides = {}) {
  return {
    user_id: "u", from_at: "2026-10-01T00:00:00Z", to_at: "2026-10-20T00:00:00Z", currency: "KRW",
    charge_krw_milli: models.reduce((sum, item) => sum + item.charge_krw_milli, 0),
    unpriced_calls: models.reduce((sum, item) => sum + item.unpriced_calls, 0),
    needs_review_calls: models.reduce((sum, item) => sum + item.needs_review_calls, 0),
    models, ...overrides
  };
}

test("스냅샷 이름은 접미사를 떼고 카탈로그 표시 이름을 찾는다", () => {
  for (const suffix of ["-2025-08-07", "-20250807", "-001", "-latest"]) {
    const summary = summarizeModelUsage(charges([charge({ model: `gpt-5-nano${suffix}`, input_tokens: 1 })]), CATALOG);
    assert.equal(summary.models[0].label, "GPT-5 Nano", suffix);
  }
});

test("같은 표시 모델로 찾아진 줄은 한 줄로 합치고 토큰·음성·글자·금액을 더한다", () => {
  const summary = summarizeModelUsage(charges([
    charge({ calls: 2, input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, reasoning_tokens: 50, charge_krw_milli: 100, audio_seconds: 5 }),
    charge({ model: "gpt-6-luna-2026-09-01", calls: 3, input_tokens: 500, output_tokens: 100, charge_krw_milli: 300, unpriced_calls: 1, tts_characters: 7 })
  ]), CATALOG);
  assert.deepEqual(summary.models, [{
    key: "openai/gpt-6-luna", label: "GPT-6 Luna", provider: "openai",
    inputTokens: 1500, outputTokens: 300, cachedInputTokens: 400, totalTokens: 1800,
    audioSeconds: 5, ttsCharacters: 7, chargeKrwMilli: 400, unpricedCalls: 1
  }]);
  assert.equal(summary.inputTokens, 1500);
  assert.equal(summary.outputTokens, 300);
  assert.equal(summary.totalTokens, 1800);
  assert.equal(summary.calls, 5);
});

test("접미사가 붙은 이름이 카탈로그에 그대로 있으면 그 항목을 쓴다", () => {
  const catalog = [
    { provider: "claude", model: "claude-haiku", display_name: "Claude Haiku" },
    { provider: "claude", model: "claude-haiku-20251001", display_name: "Claude Haiku 2025" }
  ];
  const summary = summarizeModelUsage(charges([charge({ provider: "claude", model: "claude-haiku-20251001", input_tokens: 1 })]), catalog);
  assert.equal(summary.models[0].label, "Claude Haiku 2025");
});

test("카탈로그에 없으면 모델 id를 그대로 보이고 스냅샷끼리 합치지 않는다", () => {
  const summary = summarizeModelUsage(charges([
    charge({ model: "whisper-x-2025-01-01", input_tokens: 10 }),
    charge({ model: "whisper-x-2025-02-01", input_tokens: 5 })
  ]), CATALOG);
  assert.deepEqual(summary.models.map((item) => item.label), ["whisper-x-2025-01-01", "whisper-x-2025-02-01"]);
});

test("접미사가 아닌 꼬리와 다른 공급사는 카탈로그와 맞추지 않는다", () => {
  const summary = summarizeModelUsage(charges([
    charge({ model: "gpt-6-luna-mini", input_tokens: 10 }),
    charge({ model: "gpt-6-luna-01", input_tokens: 5 }),
    charge({ provider: "claude", model: "gpt-6-luna", input_tokens: 1 })
  ]), CATALOG);
  assert.deepEqual(summary.models.map((item) => item.label), ["gpt-6-luna-mini", "gpt-6-luna-01", "gpt-6-luna"]);
});

test("채팅 카탈로그에 없는 음성 모델은 표시 이름으로 보이고 스냅샷은 한 줄로 합친다", () => {
  const summary = summarizeModelUsage(charges([
    charge({ model: "gpt-transcribe", audio_seconds: 60, charge_krw_milli: 400 }),
    charge({ model: "gpt-transcribe-2026-09-01", audio_seconds: 30, charge_krw_milli: 200 }),
    charge({ model: "gpt-live-transcribe", audio_seconds: 10, charge_krw_milli: 300 }),
    charge({ model: "gpt-realtime-2.1-mini", input_tokens: 5, output_tokens: 20, charge_krw_milli: 500 })
  ]), CATALOG);
  assert.deepEqual(
    summary.models.map((item) => [item.key, item.label, item.audioSeconds]),
    [
      ["openai/gpt-realtime-2.1-mini", "GPT Realtime 2.1 Mini", 0],
      ["openai/gpt-transcribe", "GPT Transcribe", 90],
      ["openai/gpt-live-transcribe", "GPT Live Transcribe", 10]
    ]
  );
});

test("음성 모델이 카탈로그에 있으면 카탈로그 이름이 우선하고, 다른 공급사 줄에는 음성 이름을 쓰지 않는다", () => {
  const catalog = [...CATALOG, { provider: "openai", model: "gpt-transcribe", display_name: "서버 이름" }];
  const summary = summarizeModelUsage(charges([
    charge({ model: "gpt-transcribe", input_tokens: 2 }),
    charge({ provider: "gemini", model: "gpt-transcribe", input_tokens: 1 })
  ]), catalog);
  assert.deepEqual(summary.models.map((item) => item.label), ["서버 이름", "gpt-transcribe"]);
});

test("음성 표시 이름은 잠금 모델 목록에 끼어들지 않는다", () => {
  const speechIds = ["gpt-transcribe", "gpt-live-transcribe", "gpt-realtime-2.1-mini", "gpt-4o-mini-tts"];
  assert.deepEqual(LOCKED_AI_MODELS.filter((item) => speechIds.includes(item.model)), []);
});

test("합계 금액과 안내 건수는 응답 최상위 값을 쓴다", () => {
  const summary = summarizeModelUsage(charges([charge({ input_tokens: 10, charge_krw_milli: 100 })], {
    charge_krw_milli: 3334, unpriced_calls: 2, needs_review_calls: 1
  }), CATALOG);
  assert.equal(summary.chargeKrwMilli, 3334);
  assert.equal(summary.unpricedCalls, 2);
  assert.equal(summary.needsReviewCalls, 1);
});

test("토큰 없이 글자 수·음성 초로 과금된 줄도 표에 남고 금액이 합계에 들어간다", () => {
  const summary = summarizeModelUsage(charges([
    charge({ input_tokens: 1000, charge_krw_milli: 1500 }),
    charge({ model: "gpt-4o-mini-tts", tts_characters: 1800, charge_krw_milli: 2160 }),
    charge({ model: "whisper-1", audio_seconds: 90, charge_krw_milli: 3000 })
  ]), CATALOG);
  assert.deepEqual(
    summary.models.map((item) => [item.label, item.totalTokens, item.chargeKrwMilli]),
    [["GPT-6 Luna", 1000, 1500], ["whisper-1", 0, 3000], ["GPT-4o Mini TTS", 0, 2160]]
  );
  assert.equal(summary.chargeKrwMilli, 6660);
  assert.equal(summary.totalTokens, 1000);
});

test("사용량을 몰라 0원 처리된 호출만 있는 줄도 남아 빈 화면이 되지 않는다", () => {
  const summary = summarizeModelUsage(charges([charge({ calls: 2, needs_review_calls: 2 })]), CATALOG);
  assert.equal(summary.models.length, 1);
  assert.equal(summary.calls, 2);
  assert.equal(summary.needsReviewCalls, 2);
});

test("합계가 큰 모델부터, 토큰이 같으면 금액이 큰 모델부터 보인다", () => {
  const summary = summarizeModelUsage(charges([
    charge({ input_tokens: 10, output_tokens: 5 }),
    charge({ provider: "gemini", model: "gemini-3.5-flash-lite", input_tokens: 900, output_tokens: 100 }),
    charge({ model: "tts-a", charge_krw_milli: 1, tts_characters: 1 }),
    charge({ model: "tts-b", charge_krw_milli: 2, tts_characters: 1 })
  ]), CATALOG);
  assert.deepEqual(summary.models.map((item) => item.label), ["Gemini 3.5 Flash-Lite", "GPT-6 Luna", "tts-b", "tts-a"]);
});

test("빈 응답은 합계 0이다", () => {
  assert.deepEqual(summarizeModelUsage(charges([]), CATALOG), {
    models: [], inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, chargeKrwMilli: 0, unpricedCalls: 0, needsReviewCalls: 0
  });
});

test("이상한 값(음수·null)은 0으로 보고 사용량이 하나도 없는 줄은 뺀다", () => {
  const summary = summarizeModelUsage(charges([charge({ calls: 0, input_tokens: -5, output_tokens: null, charge_krw_milli: null })], {
    charge_krw_milli: -1, unpriced_calls: null, needs_review_calls: undefined
  }), CATALOG);
  assert.equal(summary.models.length, 0);
  assert.equal(summary.totalTokens, 0);
  assert.equal(summary.chargeKrwMilli, 0);
  assert.equal(summary.unpricedCalls, 0);
  assert.equal(summary.needsReviewCalls, 0);
});

test("금액은 단가 없는 호출만 있어 0원일 때만 알 수 없음(null)이다", () => {
  assert.equal(formatKnownCharge(0, 2), null);
  assert.equal(formatKnownCharge(0, 0), "₩0");
  assert.equal(formatKnownCharge(2000, 1), "₩2");
});

test("토큰 밖 사용량은 음성 시간과 글자 수로 보이고 없으면 null이다", () => {
  assert.equal(formatNonTokenUsage({ audioSeconds: 0, ttsCharacters: 0 }), null);
  assert.equal(formatNonTokenUsage({ audioSeconds: 45, ttsCharacters: 0 }), "음성 45초");
  assert.equal(formatNonTokenUsage({ audioSeconds: 0.4, ttsCharacters: 0 }), "음성 1초");
  assert.equal(formatNonTokenUsage({ audioSeconds: 120, ttsCharacters: 0 }), "음성 2분");
  assert.equal(formatNonTokenUsage({ audioSeconds: 125, ttsCharacters: 1800 }), "음성 2분 5초 · 1,800자");
});

test("기간: 이번 달은 1일 0시부터 지금까지, 지난 달은 지난 달 1일부터 이번 달 1일 전까지", () => {
  const now = new Date(2026, 9, 20, 15, 30);
  assert.deepEqual(resolveUsageRange("this_month", now), { from: new Date(2026, 9, 1), to: new Date(2026, 9, 20, 15, 31) });
  assert.deepEqual(resolveUsageRange("last_month", now), { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) });
  const january = new Date(2026, 0, 5);
  assert.deepEqual(resolveUsageRange("last_month", january), { from: new Date(2025, 11, 1), to: new Date(2026, 0, 1) });
});

test("기간: 지난 30일은 끝 시각으로부터 30일 전부터", () => {
  const range = resolveUsageRange("last_30_days", new Date(2026, 9, 20, 15, 30));
  assert.equal(range.to.getTime() - range.from.getTime(), 30 * 24 * 60 * 60 * 1000);
  assert.deepEqual(range.to, new Date(2026, 9, 20, 15, 31));
});

test("기간: 끝 시각은 다음 분 정각으로 올려 같은 분 안에서는 같은 범위이고 방금 쓴 사용량도 들어간다", () => {
  const at = new Date(2026, 9, 20, 15, 30, 5, 120);
  const first = resolveUsageRange("this_month", at);
  const again = resolveUsageRange("this_month", new Date(2026, 9, 20, 15, 30, 59, 999));
  assert.deepEqual(first.to, new Date(2026, 9, 20, 15, 31));
  assert.ok(first.to.getTime() > at.getTime(), "끝 시각은 지금보다 뒤다([from, to)에 지금 분의 사용량이 들어간다)");
  assert.equal(first.to.getTime(), again.to.getTime());
  const last30 = resolveUsageRange("last_30_days", new Date(2026, 9, 20, 15, 30, 42));
  assert.equal(last30.to.getTime() - last30.from.getTime(), 30 * 24 * 60 * 60 * 1000);
  assert.deepEqual(last30.to, new Date(2026, 9, 20, 15, 31));
});

test("기간 경계: 매달 1일 0시 첫 1분에도 이번 달은 시작 < 끝이다", () => {
  for (const at of [new Date(2026, 10, 1, 0, 0, 0, 0), new Date(2026, 10, 1, 0, 0, 30), new Date(2026, 10, 1, 0, 0, 59, 999)]) {
    const range = resolveUsageRange("this_month", at);
    assert.deepEqual(range.from, new Date(2026, 10, 1));
    assert.deepEqual(range.to, new Date(2026, 10, 1, 0, 1));
    assert.ok(range.from < range.to);
  }
  assert.deepEqual(resolveUsageRange("last_month", new Date(2026, 10, 1, 0, 0, 0, 0)), { from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
});

test("기간 경계: 말일 23:59에 끝 시각이 다음 달로 올라가도 달은 지금 시각 기준이다", () => {
  const at = new Date(2026, 9, 31, 23, 59, 30);
  assert.deepEqual(resolveUsageRange("this_month", at), { from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
  assert.deepEqual(resolveUsageRange("last_month", at), { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) });
  assert.equal(formatUsageRange(resolveUsageRange("this_month", at)), "10월 1일 ~ 10월 31일");
});

test("숫자는 ko-KR 천 단위 구분 기호로 보인다", () => {
  assert.equal(formatTokenCount(1234567), "1,234,567");
  assert.equal(formatTokenCount(0), "0");
});

test("기간 문구: 자정으로 끝나는 기간은 전날까지로 보인다", () => {
  assert.equal(formatUsageRange({ from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) }), "9월 1일 ~ 9월 30일");
  assert.equal(formatUsageRange({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 20, 15) }), "10월 1일 ~ 10월 20일");
});

test("큰 토큰 수는 만·억 단위로 줄이고 1만 미만은 그대로 보인다", () => {
  assert.equal(formatCompactTokenCount(0), "0");
  assert.equal(formatCompactTokenCount(3170), "3,170");
  assert.equal(formatCompactTokenCount(9999), "9,999");
  assert.equal(formatCompactTokenCount(10000), "1만");
  assert.equal(formatCompactTokenCount(78257), "7.8만");
  assert.equal(formatCompactTokenCount(1234567), "123.5만");
  assert.equal(formatCompactTokenCount(99999999), "1억");
  assert.equal(formatCompactTokenCount(123456789), "1.2억");
});

test("비율은 합이 정확히 100인 정수 %다", () => {
  assert.deepEqual(toPercentShares([72200, 6057]), [92, 8]);
  assert.deepEqual(toPercentShares([75087, 3170]), [96, 4]);
  assert.deepEqual(toPercentShares([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(toPercentShares([1000, 1]), [100, 0]);
  assert.deepEqual(toPercentShares([0, 0]), [0, 0]);
  assert.deepEqual(toPercentShares([]), []);
  for (const values of [[5, 5, 5, 5, 5, 5, 5], [1, 2, 3, 4], [999, 1, 1]]) {
    assert.equal(toPercentShares(values).reduce((sum, value) => sum + value, 0), 100);
  }
});

test("0%로 반올림된 0 아닌 값은 <1%로 보인다", () => {
  assert.equal(formatPercentShare(0, 1), "<1%");
  assert.equal(formatPercentShare(0, 0), "0%");
  assert.equal(formatPercentShare(92, 72200), "92%");
});

test("formatKrwMilli rounds to whole won and shows ₩1 미만 for sub-won amounts", () => {
  assert.equal(formatKrwMilli(0), "₩0");
  assert.equal(formatKrwMilli(120), "₩1 미만");
  assert.equal(formatKrwMilli(499.9), "₩1 미만");
  assert.equal(formatKrwMilli(500), "₩1");
  assert.equal(formatKrwMilli(1_240_400), "₩1,240");
  assert.equal(formatKrwMilli(Number.NaN), "₩0");
});

test("사용량 재조회는 실패 전까지 정해진 주기로 돌고 실패하면 멈춘다", () => {
  assert.equal(AI_USAGE_REFETCH_INTERVAL_MS, 60_000);
  assert.equal(usageRefetchInterval(null), AI_USAGE_REFETCH_INTERVAL_MS);
  assert.equal(usageRefetchInterval(new Error("503")), false);
});

test("재조회 때 범위를 다시 계산하면 끝 시각이 지금 쪽으로 옮겨 간다", () => {
  const first = new Date(2026, 10, 4, 12, 0, 30);
  const later = new Date(first.getTime() + AI_USAGE_REFETCH_INTERVAL_MS);
  for (const period of ["this_month", "last_30_days"]) {
    const before = resolveUsageRange(period, first);
    const after = resolveUsageRange(period, later);
    assert.equal(after.to.getTime() - before.to.getTime(), AI_USAGE_REFETCH_INTERVAL_MS, period);
  }
});
