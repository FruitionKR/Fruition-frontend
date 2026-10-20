import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTokenCount,
  formatUsageRange,
  resolveUsageRange,
  summarizeModelUsage
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
  assert.deepEqual(summarizeModelUsage([], CATALOG), { models: [], inputTokens: 0, outputTokens: 0, totalTokens: 0, unknownUsageCalls: 0 });
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
