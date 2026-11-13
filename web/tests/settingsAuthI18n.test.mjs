import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { browserEnv } from "./asyncHookShim.mjs";
import { translator } from "./helpers/i18nMessages.mjs";

// 설정·인증·공용 API 영역이 영어 화면에서 한국어를 섞지 않는지 본다(번역 함수를 넘기지 않던 호출처 정리).
// 앱 소스의 경로 별칭(@/)과 확장자 없는 상대 import만 .ts로 푼다. react는 그대로 둔다(컴포넌트 렌더가 CJS로 부른다).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      return nextResolve(existsSync(new URL(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`, context);
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

const { ERROR_MESSAGES, apiFetch, parseApiError } = await import("../src/shared/api/client.ts");
const { saveAccessToken, setSessionExpiredHandler } = await import("../src/shared/lib/authSessionStorage.ts");
const { registerSharedTranslate, currentSharedTranslate } = await import("../src/shared/i18n/sharedTranslate.ts");
const { describeLimitError } = await import("../src/entities/workspace/model/workspaceLimits.ts");
const { describeStorageUsage } = await import("../src/entities/workspace/model/storageUsage.ts");
const { fetchMembers } = await import("../src/entities/workspace/api/members.ts");
const { fetchInvitation } = await import("../src/entities/workspace/api/invitations.ts");
const { updateAccountLocale } = await import("../src/entities/user/api/account.ts");
const { ApiError, SessionExpiredError, UPLOAD_LIMIT_MESSAGES } = await import("../src/shared/lib/apiErrors.ts");
const aiUsage = await import("../src/entities/ai/model/aiUsage.ts");
const aiModel = await import("../src/entities/ai/model/aiModel.ts");

const ko = translator("ko", "shared");
const en = translator("en", "shared");
const HANGUL = /[가-힣]/;

/** 브라우저 전역을 두고 SharedTranslatorBridge처럼 번역 함수를 등록한다. 끝나면 등록을 지운다. */
function useLocaleBridge(t, translate) {
  // after 훅은 등록 순서대로 돈다. window를 되돌리기 전에 등록을 지워야 한다(window가 없으면 무시된다).
  t.after(() => registerSharedTranslate(null));
  browserEnv(t);
  registerSharedTranslate(translate);
}

/** 서버가 message 없이 실패를 돌려주는 fetch. */
function failingFetch(t, status = 500, body = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  t.after(() => { globalThis.fetch = original; });
}

test("공통 에러 메시지는 등록된 언어로 읽히고, 등록이 없으면 한국어 원문이다", (t) => {
  const korean = { ...ERROR_MESSAGES };
  assert.equal(Object.keys(korean).length > 30, true, "열거할 수 있어 기존처럼 펼쳐 쓸 수 있다");
  for (const value of Object.values(korean)) assert.match(value, HANGUL);

  useLocaleBridge(t, ko);
  assert.deepEqual({ ...ERROR_MESSAGES }, korean, "ko 메시지는 기존 한국어 원문과 같다");

  registerSharedTranslate(en);
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) assert.doesNotMatch(value, HANGUL, `${key}: ${value}`);
  assert.equal(ERROR_MESSAGES.loginRequired, "Please sign in.");
});

test("API 함수의 기본 오류 문구(서버 message가 빈 경우)가 지금 언어로 나온다", async (t) => {
  useLocaleBridge(t, en);
  failingFetch(t);
  await assert.rejects(fetchMembers("ws_test"), { message: "Couldn't load the member list." });
  await assert.rejects(fetchInvitation("token"), { message: "Couldn't load the invitation." });
  await assert.rejects(updateAccountLocale("en"), { message: "Couldn't save your language setting." });

  registerSharedTranslate(null);
  await assert.rejects(fetchMembers("ws_test"), { message: "멤버 목록을 불러오지 못했습니다." }, "번역 함수가 없으면(서버 렌더·테스트) 한국어");
});

test("세션 만료·인증 갱신 실패 에러 메시지가 지금 언어로 나온다", async (t) => {
  useLocaleBridge(t, en);
  t.after(() => setSessionExpiredHandler(null));
  setSessionExpiredHandler(() => {});
  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), (error) => {
    assert.ok(error instanceof SessionExpiredError);
    assert.equal(error.message, "Please sign in.");
    return true;
  });

  saveAccessToken("test-access");
  t.mock.method(globalThis, "fetch", async (path) => new Response(null, { status: String(path).includes("/refresh") ? 503 : 401 }));
  await assert.rejects(apiFetch("/api/workspaces/ws_test/documents"), { message: "Couldn't refresh your sign-in. Please try again in a moment." });
});

test("서버 message는 그대로 두고, 사용량·업로드 한도 안내만 앱 문구를 지금 언어로 고른다", async (t) => {
  useLocaleBridge(t, en);
  const json = (status, body) => new Response(JSON.stringify(body), { status });
  assert.equal((await parseApiError(json(500, { error: { message: "Server said" } }), "fallback")).message, "Server said");
  for (const code of Object.keys(UPLOAD_LIMIT_MESSAGES)) {
    const error = await parseApiError(json(413, { error: { code, message: "서버 문구" } }), "fallback");
    assert.doesNotMatch(error.message, HANGUL, code);
  }
  const daily = await parseApiError(json(429, { error: { code: "AI_USAGE_LIMIT_EXCEEDED", message: "서버 문구" } }), "fallback");
  assert.doesNotMatch(daily.message, HANGUL);
});

test("워크스페이스 제한 안내: t를 넘기거나 브라우저에 등록된 언어를 따른다", (t) => {
  const errors = [...Object.keys(UPLOAD_LIMIT_MESSAGES), "WORKSPACE_LIMIT_EXCEEDED"].map((code) => new ApiError("server", 409, code));
  const fallback = errors.map((error) => describeLimitError(error));
  for (const message of fallback) assert.match(message, HANGUL);
  assert.deepEqual(errors.map((error) => describeLimitError(error, ko)), fallback, "ko 메시지는 기존 한국어 문구와 같다");
  for (const error of errors) assert.doesNotMatch(describeLimitError(error, en), HANGUL);
  assert.equal(describeLimitError(new ApiError("server", 409, "OTHER"), en), null);
  assert.equal(describeLimitError(new ApiError("server", 429, "AI_USAGE_LIMIT_EXCEEDED"), en), null, "AI 한도는 업로드 제한 안내가 아니다");

  useLocaleBridge(t, en);
  assert.equal(currentSharedTranslate(), en);
  assert.equal(describeLimitError(errors.at(-1)), "You can't create more free workspaces. Delete a workspace you no longer use and try again.");
});

test("저장 공간 문구를 t로 지금 언어에 맞춘다", () => {
  const GB = 1024 ** 3;
  for (const storage of [{ used_bytes: GB, limit_bytes: 5 * GB }, { used_bytes: GB, limit_bytes: null }]) {
    const fallback = describeStorageUsage(storage);
    assert.deepEqual(describeStorageUsage(storage, ko), fallback);
    assert.doesNotMatch(describeStorageUsage(storage, en).label, HANGUL);
  }
});

// AiUsageBreakdown을 실제 메시지로 렌더한다. 외부 모듈은 순수 모델만 쓰고 아이콘·CSS는 대역이다.
const require = createRequire(import.meta.url);
function loadComponent(path, aliases) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const exports = {};
  runInNewContext(output, { exports, require: (id) => aliases[id] ?? require(id) });
  return exports;
}

function renderUsage(locale) {
  const intl = { useTranslations: (namespace) => translator(locale, namespace), useLocale: () => locale };
  const { AiUsageBreakdown } = loadComponent("../src/features/user-settings/ui/panels/AiUsageBreakdown.tsx", {
    "next-intl": intl,
    "@/entities/ai": { ...aiUsage, ...aiModel },
    "@/shared/ui/SvgIcon": { claudeIcon: {}, geminiIcon: {}, gptIcon: {}, SvgIcon: () => null },
    "./AiUsageSection.module.css": new Proxy({}, { get: (_, key) => String(key) })
  });
  const row = (label, provider, tokens, extra = {}) => ({
    key: label, label, provider, inputTokens: tokens * 0.7, outputTokens: tokens * 0.3, cachedInputTokens: 0,
    totalTokens: tokens, calls: 3, audioSeconds: 0, ttsCharacters: 0, chargeKrwMilli: 1_240_400, unpricedCalls: 0, ...extra
  });
  const summary = {
    models: [
      row("GPT-5", "openai", 78_257),
      row("GPT Transcribe", "openai", 0, { audioSeconds: 125, chargeKrwMilli: 300 }),
      row("GPT-4o Mini TTS", "openai", 0, { ttsCharacters: 1800, chargeKrwMilli: 0, unpricedCalls: 1 })
    ],
    inputTokens: 54_780, outputTokens: 23_477, totalTokens: 78_257, calls: 9, chargeKrwMilli: 1_240_700, unpricedCalls: 1, needsReviewCalls: 1
  };
  const rangeLabel = aiUsage.formatUsageRange({ from: new Date(2026, 10, 1), to: new Date(2026, 10, 8) }, locale);
  return renderToStaticMarkup(React.createElement(AiUsageBreakdown, { summary, rangeLabel }));
}

test("AI 사용량 표(음성 시간·글자 수·1원 미만·축약 토큰)가 영어 화면에서 한국어를 섞지 않는다", () => {
  const korean = renderUsage("ko");
  assert.match(korean, /음성 2분 5초/);
  assert.match(korean, /7\.8만/);
  const english = renderUsage("en");
  assert.doesNotMatch(english, HANGUL, english.match(/.{0,40}[가-힣]+.{0,40}/)?.[0]);
  assert.match(english, /78\.3K/);
});

function renderCredits(entries, locale = "ko", charge_history) {
  const { AiCreditSection } = loadComponent("../src/features/user-settings/ui/panels/AiCreditSection.tsx", {
    "next-intl": { useTranslations: (namespace) => translator(locale, namespace), useLocale: () => locale },
    "@tanstack/react-query": { useQuery: ({ queryKey }) => queryKey[0] === "credits"
      ? { data: { available_krw_milli: 100000, reserved_krw_milli: 0, entries, charge_history } } : { data: null } },
    "@/entities/ai": { ...aiUsage, fetchCredits() {} },
    "@/entities/user": { useMe: () => ({ data: { id: "user" } }), fetchBetaCredit() {} },
    "@/shared/lib/apiErrors": { ApiError, getErrorMessage() {} },
    "../SettingsSectionHeader": { SettingsSectionHeader: ({ children }) => React.createElement("h3", null, children) },
    "../SettingsModal.module.css": {},
    "./AiUsageSection.module.css": {}
  });
  return renderToStaticMarkup(React.createElement(AiCreditSection));
}

test("크레딧 내역은 실제 차감만 표시하며 MCP 수수료를 따로 합산한다", () => {
  const entry = (type, amount, reason) => ({ type, amount_krw_milli: amount, reason, run_id: "r", created_at: "2026-11-12T00:00:00Z" });
  const html = renderCredits([
    entry("reserve", 99000, "mcp_approval"), entry("release", -88000, "mcp_approval"),
    entry("grant", 500000, "beta"), entry("charge", -10000, "mcp_approval"),
    entry("charge", -20000, "mcp_approval"), entry("charge", -1234, "chat")
  ]);
  assert.match(html, /표시된 MCP 작업 수수료 합계/);
  assert.match(html, /₩30/);
  assert.match(html, /₩1\.234/);
  assert.doesNotMatch(html, /₩99|₩88|₩500/);
  assert.equal((html.match(/<time /g) ?? []).length, 3);
  assert.match(html, /최근 원장 50건/);
});

test("원장이 없는 이전 응답은 합계를 0원으로 꾸미지 않으며 빈 원장과 구분한다", () => {
  assert.doesNotMatch(renderCredits(undefined), /표시된 MCP 작업 수수료 합계/);
  assert.match(renderCredits([]), /최근 원장에 차감 내역이 없어요/);
  assert.doesNotMatch(renderCredits([], "en"), HANGUL);
});

const groupedUsage = {
  workspace_id: "ws", kind: "ingest", provider: "test-provider", model: "model-a", calls: 9,
  input_tokens: 900, output_tokens: 100, cached_input_tokens: null, cache_creation_tokens: 0,
  audio_seconds: null, tts_characters: null, amount_krw_milli: 56179,
  started_at: "2026-11-12T09:43:34Z", last_started_at: "2026-11-12T09:44:34Z"
};
const groupedHistory = [
  { id: 1, run_id: "run", reason: null, amount_krw_milli: 56179, charged_at: "2026-11-13T09:47:15Z", usage: [groupedUsage] },
  { id: 2, run_id: "mcp", reason: "mcp_approval", amount_krw_milli: 2000, charged_at: "2026-11-13T09:47:15Z", usage: [] }
];

test("실행별 내역은 작업·모델·호출수와 실제 차감 합계를 표시하고 정산/호출 시각을 구분한다", () => {
  const html = renderCredits([{ type: "charge", amount_krw_milli: -999999 }], "ko", groupedHistory);
  assert.match(html, /위키 편입 · model-a/);
  assert.match(html, /모델 호출 9회/);
  assert.match(html, /₩56\.179/);
  assert.match(html, /최근 정산/);
  assert.match(html, /모델 호출 시각/);
  assert.match(html, /입력 900 · 출력 100 · 캐시 읽기 미확인 · 캐시 생성 0 토큰/);
  assert.match(html, /<details/);
  assert.match(html, /<summary>사용량 상세 보기/);
  assert.match(html, /최근 차감된 실행 50건/);
  assert.match(html, /₩2/);
  assert.doesNotMatch(html, /999\.999/);
  assert.equal((html.match(/<details/g) ?? []).length, 1, "MCP 수수료에는 모델 내역을 붙이지 않는다");
  assert.doesNotMatch(renderCredits([], "en", groupedHistory), HANGUL);
});

test("상세가 없는 실제 차감과 알 수 없는 작업·모델은 추정하지 않는다", () => {
  const missing = [{ ...groupedHistory[0], usage: [] }];
  assert.match(renderCredits([], "ko", missing), /상세 정보가 없거나 집계 중/);
  assert.match(renderCredits([], "ko", missing), /₩56\.179/);
  const unknown = [{ ...groupedHistory[0], usage: [{ ...groupedUsage, kind: "future-kind", model: null }] }];
  assert.match(renderCredits([], "ko", unknown), /작업 정보 없음 · 모델 정보 없음/);
  // 에이전트 대화 턴은 document 명령 kind "agent" 그대로 사용량에 기록된다.
  const agent = [{ ...groupedHistory[0], usage: [{ ...groupedUsage, kind: "agent" }] }];
  assert.match(renderCredits([], "ko", agent), /에이전트 요청 · model-a/);
  assert.match(renderCredits([], "en", agent), /Agent request · model-a/);
  assert.doesNotMatch(renderCredits([], "en", unknown), HANGUL);
  assert.match(renderCredits([], "ko", []), /최근 원장에 차감 내역이 없어요/);
});

test("같은 시각의 다른 실행과 한 실행의 여러 모델을 별도 금액으로 표시한다", () => {
  const history = [
    { ...groupedHistory[0], amount_krw_milli: 59179, usage: [groupedUsage, { ...groupedUsage, model: "model-b", calls: 1, amount_krw_milli: 3000 }] },
    { ...groupedHistory[0], id: 3, run_id: "other-run", amount_krw_milli: 4000, usage: [{ ...groupedUsage, calls: 1, amount_krw_milli: 4000 }] }
  ];
  const html = renderCredits([], "ko", history);
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.match(html, /model-b/);
  assert.doesNotMatch(html, /AI 사용료/);
  assert.match(html, /모델 호출 10회/);
  assert.match(html, /₩59\.179/);
  assert.match(html, /₩4/);
});
