// document-svc(8080) 본인 모델 사용량: GET /api/workspaces/:wid/usage/models?from_at&to_at.
// 실제 백엔드는 ai `/usage/models` 응답(provider·requested_model·model 묶음 집계)을 그대로 돌려준다. 금액은 없다.
// 본인 청구 금액: GET /api/users/me/usage/charges?from_at&to_at. 워크스페이스를 가로질러 응답 모델별로 합친
// 부가세 포함 milli-KRW다. MOCK_USAGE_CHARGES_FAIL=1이면 503으로 금액 실패 상태를 재현한다.
import { state, error } from "../state.mjs";
import { WORKSPACE_ID } from "../seed.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

// 호출 종류별 [provider, requested_model, 응답 model 후보, 입력 토큰 범위, 출력 토큰 범위, 며칠 전까지]
const CALL_KINDS = [
  ["openai", "gpt-6-luna", ["gpt-6-luna", "gpt-6-luna-2026-08-28"], [1800, 9000], [300, 1600], 55],
  ["gemini", "gemini-3.5-flash-lite", ["gemini-3.5-flash-lite"], [6000, 24000], [800, 3200], 55],
  ["claude", "claude-haiku-4-5-20251001", ["claude-haiku-4-5-20251001"], [2500, 7000], [400, 1200], 20],
  // 저가 모델 정책(2026-10-18) 전에 쓰던 모델. 지난 사용량에만 남는다.
  ["openai", "gpt-5.5", ["gpt-5.5"], [3000, 12000], [500, 2000], 55, 25]
];

// 다른 워크스페이스 호출(사용량 화면에는 안 보이고 청구 합계에만 더해진다). TTS는 토큰 없이 글자 수로 매긴다.
const OTHER_WORKSPACE_ID = "ws_other";
const OTHER_CALLS = [
  ["openai", "gpt-6-luna", 5200, 900, 0, 3],
  ["gemini", "gemini-3.5-flash-lite", 14000, 2100, 0, 8],
  ["openai", "gpt-4o-mini-tts", 0, 0, 1800, 5]
];

// mock 전용 금액 규칙(milli-KRW / 토큰·글자). 실제 단가는 백엔드 ai_model_prices·환율·정책으로 정해진다.
// gpt-5.5는 단가 행이 없는 모델(unpriced)로 둔다.
const MOCK_RATES = {
  "openai/gpt-6-luna": [2.4, 0.24, 14.4],
  "openai/gpt-6-luna-2026-08-28": [2.4, 0.24, 14.4],
  "gemini/gemini-3.5-flash-lite": [0.15, 0.04, 0.6],
  "claude/claude-haiku-4-5-20251001": [1.9, 0.19, 9.5]
};
const TTS_MILLI_PER_CHAR = 1.2;

/** 같은 데모 결과가 나오도록 고정 시드 난수로 지난 55일치 호출 원장을 만든다(워크스페이스·사용자 하나). */
function buildLedger(userId) {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const between = ([min, max]) => Math.round(min + random() * (max - min));
  const nowMs = Date.now();
  const calls = [];
  for (let index = 0; index < 160; index += 1) {
    const [provider, requested, models, input, output, maxDays, minDays = 0] = CALL_KINDS[index % CALL_KINDS.length];
    const startedAt = nowMs - (minDays + random() * (maxDays - minDays)) * DAY_MS;
    const known = random() > 0.04;
    const inputTokens = between(input);
    calls.push({
      workspace_id: WORKSPACE_ID, user_id: userId, provider, requested_model: requested,
      model: models[Math.floor(random() * models.length)], started_at: startedAt,
      status: random() > 0.05 ? "succeeded" : "failed",
      input_tokens: known ? inputTokens : null,
      output_tokens: known ? between(output) : null,
      cached_input_tokens: known ? Math.round(inputTokens * random() * 0.4) : null,
      cache_creation_tokens: 0,
      reasoning_tokens: known && provider === "openai" ? Math.round(between(output) * 0.2) : 0
    });
  }
  for (const [provider, model, input, output, characters, daysAgo] of OTHER_CALLS) {
    calls.push({
      workspace_id: OTHER_WORKSPACE_ID, user_id: userId, provider, requested_model: model, model,
      started_at: nowMs - daysAgo * DAY_MS, status: "succeeded",
      input_tokens: input, output_tokens: output, cached_input_tokens: 0, cache_creation_tokens: 0,
      reasoning_tokens: 0, tts_characters: characters
    });
  }
  return calls;
}

/** 호출 하나의 청구 상태와 금액. 사용량을 모르면 needs_review(0원), 단가가 없으면 unpriced(합계 제외)다. */
function priceCall(call) {
  if (call.tts_characters) return { status: "charged", milli: Math.ceil(call.tts_characters * TTS_MILLI_PER_CHAR) };
  if (call.input_tokens === null || call.output_tokens === null) return { status: "needs_review", milli: 0 };
  const rate = MOCK_RATES[`${call.provider}/${call.model}`];
  if (!rate) return { status: "unpriced", milli: 0 };
  const [input, cached, output] = rate;
  const cachedTokens = call.cached_input_tokens ?? 0;
  return { status: "charged", milli: Math.ceil((call.input_tokens - cachedTokens) * input + cachedTokens * cached + call.output_tokens * output) };
}

function summarizeCharges(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = `${call.provider}|${call.model}`;
    const row = groups.get(key) ?? {
      provider: call.provider, model: call.model, calls: 0, input_tokens: 0, cached_input_tokens: 0,
      cache_creation_tokens: 0, output_tokens: 0, reasoning_tokens: 0, audio_seconds: 0, tts_characters: 0,
      charge_krw_milli: 0, unpriced_calls: 0, needs_review_calls: 0
    };
    const { status, milli } = priceCall(call);
    groups.set(key, {
      ...row,
      calls: row.calls + 1,
      input_tokens: row.input_tokens + (call.input_tokens ?? 0),
      cached_input_tokens: row.cached_input_tokens + (call.cached_input_tokens ?? 0),
      output_tokens: row.output_tokens + (call.output_tokens ?? 0),
      reasoning_tokens: row.reasoning_tokens + call.reasoning_tokens,
      tts_characters: row.tts_characters + (call.tts_characters ?? 0),
      charge_krw_milli: row.charge_krw_milli + milli,
      unpriced_calls: row.unpriced_calls + (status === "unpriced" ? 1 : 0),
      needs_review_calls: row.needs_review_calls + (status === "needs_review" ? 1 : 0)
    });
  }
  return Array.from(groups.values()).sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}

function ledgerFor(userId) {
  if (!ledgers.has(userId)) ledgers.set(userId, buildLedger(userId));
  return ledgers.get(userId);
}

const ledgers = new Map();

function summarize(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = `${call.provider}|${call.requested_model}|${call.model}`;
    const row = groups.get(key) ?? {
      provider: call.provider, requested_model: call.requested_model, model: call.model, calls: 0, failed_calls: 0,
      unfinished_calls: 0, unknown_usage_calls: 0, known_input_tokens: 0, known_output_tokens: 0,
      known_cached_input_tokens: 0, known_cache_creation_tokens: 0, known_reasoning_tokens: 0, unknown_cache_usage_calls: 0
    };
    groups.set(key, {
      ...row,
      calls: row.calls + 1,
      failed_calls: row.failed_calls + (call.status === "failed" ? 1 : 0),
      unknown_usage_calls: row.unknown_usage_calls + (call.input_tokens === null || call.output_tokens === null ? 1 : 0),
      known_input_tokens: row.known_input_tokens + (call.input_tokens ?? 0),
      known_output_tokens: row.known_output_tokens + (call.output_tokens ?? 0),
      known_cached_input_tokens: row.known_cached_input_tokens + (call.cached_input_tokens ?? 0),
      known_cache_creation_tokens: row.known_cache_creation_tokens + call.cache_creation_tokens,
      known_reasoning_tokens: row.known_reasoning_tokens + call.reasoning_tokens,
      unknown_cache_usage_calls: row.unknown_cache_usage_calls + (call.cached_input_tokens === null ? 1 : 0)
    });
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model) || a.requested_model.localeCompare(b.requested_model));
}

/** ISO 8601 시간대 포함만 받는다(ai가 시간대 없는 값을 400으로 거절한다). */
function parseInstant(value) {
  if (value === null) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return Number.NaN;
  return Date.parse(value);
}

export function registerUsageRoutes(router) {
  router.get("/api/workspaces/:wid/usage/models", (ctx) => {
    const workspace = state.workspaces.find((item) => item.id === ctx.params.wid && !item.deleted_at);
    const isMember = workspace && state.members.some((member) => member.workspace_id === workspace.id && member.user_id === ctx.user.id);
    // 실제 백엔드처럼 멤버가 아니면 403이 아니라 404다.
    if (!isMember) return error(ctx, 404, "워크스페이스를 찾을 수 없습니다.");
    const now = new Date();
    const from = parseInstant(ctx.query.get("from_at")) ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const to = parseInstant(ctx.query.get("to_at")) ?? now.getTime();
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return error(ctx, 400, "조회 기간을 확인하세요.");
    const calls = ledgerFor(ctx.user.id)
      .filter((call) => call.workspace_id === workspace.id && call.started_at >= from && call.started_at < to);
    ctx.json(200, {
      workspace_id: workspace.id, user_id: ctx.user.id,
      from_at: new Date(from).toISOString(), to_at: new Date(to).toISOString(),
      models: summarize(calls)
    });
  });

  router.get("/api/users/me/usage/charges", (ctx) => {
    if (["1", "true"].includes(process.env.MOCK_USAGE_CHARGES_FAIL ?? "")) return error(ctx, 503, "AI 사용 금액을 불러오지 못했습니다.");
    // 실제 백엔드처럼 두 값 모두 필수이고 366일 이하다.
    const from = parseInstant(ctx.query.get("from_at"));
    const to = parseInstant(ctx.query.get("to_at"));
    if (from === null || to === null || Number.isNaN(from) || Number.isNaN(to) || from >= to) {
      return error(ctx, 400, "조회 시작은 종료보다 앞서야 합니다.");
    }
    if (to - from > 366 * DAY_MS) return error(ctx, 400, "조회 기간은 366일 이하여야 합니다.");
    const models = summarizeCharges(ledgerFor(ctx.user.id).filter((call) => call.started_at >= from && call.started_at < to));
    ctx.json(200, {
      user_id: ctx.user.id, from_at: new Date(from).toISOString(), to_at: new Date(to).toISOString(), currency: "KRW",
      charge_krw_milli: models.reduce((sum, row) => sum + row.charge_krw_milli, 0),
      unpriced_calls: models.reduce((sum, row) => sum + row.unpriced_calls, 0),
      needs_review_calls: models.reduce((sum, row) => sum + row.needs_review_calls, 0),
      models
    });
  });
}
