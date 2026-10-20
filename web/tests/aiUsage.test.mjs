import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateUsageCost,
  formatCompactTokenCount,
  formatKrwMilli,
  isUnderOneWon,
  isSameWon,
  formatPercentShare,
  formatTokenCount,
  formatUsageRange,
  resolveUsageRange,
  summarizeModelUsage,
  toPercentShares
} from "../src/entities/ai/model/aiUsage.ts";

const CATALOG = [
  { provider: "openai", model: "gpt-6-luna", display_name: "GPT-6 Luna" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", display_name: "Gemini 3.5 Flash-Lite" }
];

function row(overrides) {
  return {
    provider: "openai", requested_model: "gpt-6-luna", model: "gpt-6-luna", calls: 1, failed_calls: 0,
    unfinished_calls: 0, unknown_usage_calls: 0, known_input_tokens: 0, known_output_tokens: 0,
    known_cached_input_tokens: 0, known_cache_creation_tokens: 0, known_reasoning_tokens: 0, unknown_cache_usage_calls: 0,
    ...overrides
  };
}

test("같은 요청 모델의 스냅샷 줄은 한 줄로 합치고 합계는 입력+출력만 더한다", () => {
  const summary = summarizeModelUsage([
    row({ model: "gpt-6-luna", known_input_tokens: 1000, known_output_tokens: 200, known_cached_input_tokens: 400, known_reasoning_tokens: 50 }),
    row({ model: "gpt-6-luna-2026-09-01", known_input_tokens: 500, known_output_tokens: 100 })
  ], CATALOG);
  assert.equal(summary.models.length, 1);
  assert.deepEqual(summary.models[0], {
    key: "openai/gpt-6-luna", label: "GPT-6 Luna", provider: "openai",
    inputTokens: 1500, outputTokens: 300, cachedInputTokens: 400, totalTokens: 1800
  });
  assert.equal(summary.totalTokens, 1800);
  assert.equal(summary.inputTokens, 1500);
  assert.equal(summary.outputTokens, 300);
});

test("합계가 큰 모델부터 보이고 카탈로그에 없는 모델은 id를 이름으로 쓴다", () => {
  const summary = summarizeModelUsage([
    row({ known_input_tokens: 10, known_output_tokens: 5 }),
    row({ provider: "gemini", requested_model: "gemini-3.5-flash-lite", model: "gemini-3.5-flash-lite", known_input_tokens: 900, known_output_tokens: 100 }),
    row({ provider: "openai", requested_model: "whisper-x", model: "whisper-x", known_input_tokens: 50 })
  ], CATALOG);
  assert.deepEqual(summary.models.map((item) => item.label), ["Gemini 3.5 Flash-Lite", "whisper-x", "GPT-6 Luna"]);
});

test("요청 모델이 카탈로그에 없으면 응답 모델 이름을 찾는다", () => {
  const summary = summarizeModelUsage([row({ requested_model: "old-alias", model: "gpt-6-luna", known_input_tokens: 1 })], CATALOG);
  assert.equal(summary.models[0].label, "GPT-6 Luna");
});

test("토큰이 없는 줄은 표에서 빼고 사용량 미확인 호출 수는 모은다", () => {
  const summary = summarizeModelUsage([
    row({ unknown_usage_calls: 2 }),
    row({ provider: "gemini", requested_model: "gemini-3.5-flash-lite", unknown_usage_calls: 1, known_input_tokens: 3 })
  ], CATALOG);
  assert.equal(summary.models.length, 1);
  assert.equal(summary.unknownUsageCalls, 3);
});

test("빈 응답은 합계 0이다", () => {
  assert.deepEqual(summarizeModelUsage([], CATALOG), { models: [], inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, unknownUsageCalls: 0 });
});

test("이상한 값(음수·null)은 0으로 본다", () => {
  const summary = summarizeModelUsage([row({ known_input_tokens: -5, known_output_tokens: null, known_cached_input_tokens: 7 })], CATALOG);
  assert.equal(summary.models.length, 0);
  assert.equal(summary.totalTokens, 0);
});

test("기간: 이번 달은 1일 0시부터 지금까지, 지난 달은 지난 달 1일부터 이번 달 1일 전까지", () => {
  const now = new Date(2026, 9, 20, 15, 30);
  assert.deepEqual(resolveUsageRange("this_month", now), { from: new Date(2026, 9, 1), to: now });
  assert.deepEqual(resolveUsageRange("last_month", now), { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) });
  const january = new Date(2026, 0, 5);
  assert.deepEqual(resolveUsageRange("last_month", january), { from: new Date(2025, 11, 1), to: new Date(2026, 0, 1) });
});

test("기간: 지난 30일은 지금으로부터 30일 전부터", () => {
  const now = new Date(2026, 9, 20, 15, 30);
  const range = resolveUsageRange("last_30_days", now);
  assert.equal(now.getTime() - range.from.getTime(), 30 * 24 * 60 * 60 * 1000);
  assert.equal(range.to, now);
});

test("숫자는 ko-KR 천 단위 구분 기호로 보인다", () => {
  assert.equal(formatTokenCount(1234567), "1,234,567");
  assert.equal(formatTokenCount(0), "0");
});

test("기간 문구: 자정으로 끝나는 기간은 전날까지로 보인다", () => {
  assert.equal(formatUsageRange({ from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) }), "9월 1일 ~ 9월 30일");
  assert.equal(formatUsageRange({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 20, 15) }), "10월 1일 ~ 10월 20일");
});

test("호출 수는 토큰이 없는 줄까지 모두 더한다", () => {
  const summary = summarizeModelUsage([
    row({ calls: 3, known_input_tokens: 10 }),
    row({ provider: "gemini", requested_model: "gemini-3.5-flash-lite", calls: 2, unknown_usage_calls: 2 })
  ], CATALOG);
  assert.equal(summary.calls, 5);
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

function charge(overrides) {
  return {
    provider: "openai", model: "gpt-6-luna", calls: 1, input_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0,
    output_tokens: 0, reasoning_tokens: 0, audio_seconds: 0, tts_characters: 0, charge_krw_milli: 0,
    unpriced_calls: 0, needs_review_calls: 0, ...overrides
  };
}

function charges(models, total = models.reduce((sum, item) => sum + item.charge_krw_milli, 0)) {
  return {
    user_id: "u", from_at: "2026-10-01T00:00:00Z", to_at: "2026-10-20T00:00:00Z", currency: "KRW",
    charge_krw_milli: total, unpriced_calls: 0, needs_review_calls: 0, models
  };
}

test("estimateUsageCost applies each response model's average rate to this workspace's tokens", () => {
  // Arrange: 모든 워크스페이스에서 gpt-6-luna 4,000토큰에 8원(8,000 milli) → 토큰당 2 milli
  const rows = [row({ known_input_tokens: 800, known_output_tokens: 200 })];
  const summary = charges([charge({ input_tokens: 3000, output_tokens: 1000, charge_krw_milli: 8000 })]);

  // Act
  const estimate = estimateUsageCost(rows, summary);

  // Assert
  assert.deepEqual(estimate.models, { "openai/gpt-6-luna": 2000 });
  assert.equal(estimate.totalKrwMilli, 2000);
  assert.equal(estimate.accountKrwMilli, 8000);
  assert.equal(estimate.hasUnpriced, false);
});

test("estimateUsageCost matches snapshot response models and sums them into the requested-model row", () => {
  const rows = [
    row({ model: "gpt-6-luna", known_input_tokens: 100 }),
    row({ model: "gpt-6-luna-2026-08-28", known_input_tokens: 100 })
  ];
  const summary = charges([
    charge({ model: "gpt-6-luna", input_tokens: 100, charge_krw_milli: 100 }),
    charge({ model: "gpt-6-luna-2026-08-28", input_tokens: 100, charge_krw_milli: 300 })
  ]);

  const estimate = estimateUsageCost(rows, summary);

  assert.deepEqual(estimate.models, { "openai/gpt-6-luna": 400 });
});

test("estimateUsageCost leaves models without a usable rate as null and flags them", () => {
  const rows = [
    row({ provider: "openai", requested_model: "gpt-5.5", model: "gpt-5.5", known_input_tokens: 500 }),
    row({ provider: "claude", requested_model: "claude-haiku", model: "claude-haiku", known_input_tokens: 500 }),
    row({ known_input_tokens: 0, known_output_tokens: 0 })
  ];
  // gpt-5.5는 모든 호출이 단가 없음, claude-haiku는 아직 청구가 집계되지 않음, 토큰 없는 줄은 건너뛴다
  const summary = charges([charge({ model: "gpt-5.5", calls: 2, input_tokens: 900, unpriced_calls: 2 })]);

  const estimate = estimateUsageCost(rows, summary);

  assert.deepEqual(estimate.models, { "openai/gpt-5.5": null, "claude/claude-haiku": null });
  assert.equal(estimate.totalKrwMilli, 0);
  assert.equal(estimate.hasUnpriced, true);
});

test("estimateUsageCost keeps non-token charges (TTS characters) only in the account total", () => {
  const rows = [row({ known_input_tokens: 1000 })];
  const summary = charges([
    charge({ input_tokens: 1000, charge_krw_milli: 1500 }),
    charge({ model: "gpt-4o-mini-tts", tts_characters: 1800, charge_krw_milli: 2160 })
  ]);

  const estimate = estimateUsageCost(rows, summary);

  assert.equal(estimate.totalKrwMilli, 1500);
  assert.equal(estimate.accountKrwMilli, 3660);
});

test("estimateUsageCost flags partially unpriced models but still estimates them", () => {
  const rows = [row({ known_input_tokens: 100 })];
  const summary = charges([charge({ calls: 3, input_tokens: 300, charge_krw_milli: 600, unpriced_calls: 1 })]);

  const estimate = estimateUsageCost(rows, summary);

  assert.equal(estimate.models["openai/gpt-6-luna"], 200);
  assert.equal(estimate.hasUnpriced, true);
});

test("formatKrwMilli rounds to whole won and shows ₩1 미만 for sub-won amounts", () => {
  assert.equal(formatKrwMilli(0), "₩0");
  assert.equal(formatKrwMilli(120), "₩1 미만");
  assert.equal(formatKrwMilli(499.9), "₩1 미만");
  assert.equal(isUnderOneWon(120), true);
  assert.equal(isUnderOneWon(0), false);
  assert.equal(isUnderOneWon(500), false);
  assert.equal(formatKrwMilli(500), "₩1");
  assert.equal(formatKrwMilli(1_240_400), "₩1,240");
  assert.equal(formatKrwMilli(Number.NaN), "₩0");
});

test("isSameWon compares amounts after rounding to won", () => {
  assert.equal(isSameWon(1_240_400, 1_239_600), true);
  assert.equal(isSameWon(1_240_400, 1_241_600), false);
});

test("estimateUsageCost caps a model's estimate at what that model was actually billed when usage runs ahead of charges", () => {
  // Arrange: 청구는 1,000토큰에 2원까지만 반영됐는데 사용량 집계에는 1,500토큰이 이미 있다(청구 반영 지연).
  const rows = [row({ known_input_tokens: 1200, known_output_tokens: 300 })];
  const summary = charges([charge({ input_tokens: 1000, charge_krw_milli: 2000 })]);

  // Act
  const estimate = estimateUsageCost(rows, summary);

  // Assert: 3원(3,000 milli)이 아니라 이 모델 청구액 2원까지만 보인다.
  assert.equal(estimate.models["openai/gpt-6-luna"], 2000);
  assert.equal(estimate.totalKrwMilli, 2000);
  assert.equal(estimate.isCapped, true);
});

test("estimateUsageCost caps snapshot rows per response model and keeps other models untouched", () => {
  const rows = [
    row({ model: "gpt-6-luna", known_input_tokens: 300 }),
    row({ model: "gpt-6-luna-2026-08-28", known_input_tokens: 100 }),
    row({ provider: "claude", requested_model: "claude-haiku", model: "claude-haiku", known_input_tokens: 100 })
  ];
  const summary = charges([
    charge({ model: "gpt-6-luna", input_tokens: 200, charge_krw_milli: 400 }),
    charge({ model: "gpt-6-luna-2026-08-28", input_tokens: 100, charge_krw_milli: 200 }),
    charge({ provider: "claude", model: "claude-haiku", input_tokens: 1000, charge_krw_milli: 3000 })
  ]);

  const estimate = estimateUsageCost(rows, summary);

  // gpt-6-luna는 600 → 400으로 낮추고, 스냅샷 200은 그대로 더한다. claude는 300으로 청구액 안이다.
  assert.deepEqual(estimate.models, { "openai/gpt-6-luna": 600, "claude/claude-haiku": 300 });
  assert.equal(estimate.totalKrwMilli, 900);
  assert.equal(estimate.isCapped, true);
});

test("estimateUsageCost caps the overall estimate at the account total and scales model rows to match", () => {
  const rows = [
    row({ known_input_tokens: 1000 }),
    row({ provider: "claude", requested_model: "claude-haiku", model: "claude-haiku", known_input_tokens: 1000 })
  ];
  // 모델별 청구 합(4,000)보다 전체 청구(2,000)가 늦게 집계됐다.
  const summary = charges([
    charge({ input_tokens: 1000, charge_krw_milli: 1000 }),
    charge({ provider: "claude", model: "claude-haiku", input_tokens: 1000, charge_krw_milli: 3000 })
  ], 2000);

  const estimate = estimateUsageCost(rows, summary);

  assert.equal(estimate.totalKrwMilli, 2000);
  assert.deepEqual(estimate.models, { "openai/gpt-6-luna": 500, "claude/claude-haiku": 1500 });
  assert.equal(estimate.isCapped, true);
  assert.ok(estimate.totalKrwMilli <= estimate.accountKrwMilli);
});

test("estimateUsageCost does not flag capping when the estimate stays within charges", () => {
  const rows = [row({ known_input_tokens: 800, known_output_tokens: 200 })];
  const summary = charges([charge({ input_tokens: 3000, output_tokens: 1000, charge_krw_milli: 8000 })]);

  assert.equal(estimateUsageCost(rows, summary).isCapped, false);
});
