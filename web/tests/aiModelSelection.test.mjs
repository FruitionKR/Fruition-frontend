import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderLabel,
  getProviderMenuLabel,
  groupAiModelsByProvider,
  filterWorkspaceAiModels,
  hasWorkspaceExcludedModels,
  isSameSelection,
  resolveInitialModel,
  resolveWorkspaceModelSelection,
  WORKSPACE_DEFAULT_MODEL
} from "../src/entities/ai/model/aiModel.ts";

// 저가 모델 정책 카탈로그(3개).
const POLICY_CATALOG = [
  { provider: "openai", model: "gpt-6-luna", display_name: "GPT-6 Luna" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", display_name: "Gemini 3.5 Flash-Lite" },
  { provider: "claude", model: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" }
];
const WORKSPACE_MODELS = filterWorkspaceAiModels(POLICY_CATALOG);

test("워크스페이스 모델 목록에서 Claude provider를 뺀다", () => {
  assert.deepEqual(WORKSPACE_MODELS, POLICY_CATALOG.slice(0, 2));
  assert.equal(hasWorkspaceExcludedModels(POLICY_CATALOG), true);
  assert.equal(hasWorkspaceExcludedModels(WORKSPACE_MODELS), false);
});

test("채팅 카탈로그 3개는 provider마다 모델 1개씩 묶인다", () => {
  const groups = groupAiModelsByProvider(POLICY_CATALOG);
  assert.deepEqual(groups.map((group) => [group.provider, group.models.length]), [["openai", 1], ["gemini", 1], ["claude", 1]]);
});

test("저장된 채팅 모델이 카탈로그에서 빠졌으면 catalog[0]으로 대체한다", () => {
  assert.deepEqual(resolveInitialModel(POLICY_CATALOG, { provider: "claude", model: "claude-opus-5-5" }), POLICY_CATALOG[0]);
});

test("저장된 워크스페이스 모델이 허용 목록에 있으면 그대로 보여 준다", () => {
  const saved = { provider: "openai", model: "gpt-6-luna" };
  assert.deepEqual(resolveWorkspaceModelSelection(WORKSPACE_MODELS, saved), { selection: saved, isFallback: false });
});

test("저장된 워크스페이스 모델이 Claude면 기본 모델로 대체한다", () => {
  const result = resolveWorkspaceModelSelection(WORKSPACE_MODELS, { provider: "claude", model: "claude-haiku-4-5-20251001" });
  assert.deepEqual(result, { selection: WORKSPACE_DEFAULT_MODEL, isFallback: true });
});

test("저장된 워크스페이스 모델이 카탈로그에서 빠졌으면 기본 모델로 대체한다", () => {
  const result = resolveWorkspaceModelSelection(WORKSPACE_MODELS, { provider: "openai", model: "gpt-5-nano" });
  assert.deepEqual(result, { selection: WORKSPACE_DEFAULT_MODEL, isFallback: true });
});

test("카탈로그를 받기 전에는 Claude가 아닌 저장값을 그대로 두고, Claude는 기본 모델로 보여 준다", () => {
  const saved = { provider: "openai", model: "gpt-5-nano" };
  assert.deepEqual(resolveWorkspaceModelSelection([], saved), { selection: saved, isFallback: false });
  assert.deepEqual(resolveWorkspaceModelSelection([], { provider: "claude", model: "claude-sonnet-5" }).isFallback, true);
});

test("워크스페이스 설정을 아직 못 받았으면 선택을 만들지 않는다", () => {
  assert.deepEqual(resolveWorkspaceModelSelection(WORKSPACE_MODELS, null), { selection: null, isFallback: false });
});

const CATALOG = [
  { provider: "openai", model: "gpt-5-nano", display_name: "GPT-5 nano" },
  { provider: "gemini", model: "gemini-3.1-flash-lite", display_name: "Gemini 3.1 Flash-Lite" },
  { provider: "claude", model: "claude-sonnet-5", display_name: "Claude Sonnet 5" }
];

test("저장된 선택이 카탈로그에 있으면 그대로 사용한다", () => {
  const selected = resolveInitialModel(CATALOG, { provider: "claude", model: "claude-sonnet-5" });

  assert.deepEqual(selected, CATALOG[2]);
});

test("저장된 선택이 카탈로그에 없으면 카탈로그 첫 항목으로 대체한다", () => {
  const selected = resolveInitialModel(CATALOG, { provider: "gemini", model: "gemini-flash-latest" });

  assert.deepEqual(selected, CATALOG[0]);
});

test("저장된 선택이 없으면 카탈로그 첫 항목을 쓴다", () => {
  assert.deepEqual(resolveInitialModel(CATALOG, null), CATALOG[0]);
});

test("카탈로그가 비면 선택을 만들지 않는다", () => {
  assert.equal(resolveInitialModel([], { provider: "openai", model: "gpt-5-nano" }), null);
});

test("provider와 model이 모두 같아야 같은 선택으로 본다", () => {
  assert.equal(
    isSameSelection(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-nano" }
    ),
    true
  );
  assert.equal(
    isSameSelection(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "retired-model" }
    ),
    false
  );
  assert.equal(isSameSelection({ provider: "openai", model: "gpt-5-nano" }, null), false);
});

const MIXED_CATALOG = [
  { provider: "openai", model: "gpt-5-nano", display_name: "GPT-5 nano" },
  { provider: "claude", model: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
  { provider: "openai", model: "gpt-5-mini", display_name: "GPT-5 mini" },
  { provider: "claude", model: "claude-sonnet-5", display_name: "Claude Sonnet 5" }
];

test("provider별로 묶되 provider와 모델 순서는 카탈로그 순서를 따른다", () => {
  assert.deepEqual(groupAiModelsByProvider(MIXED_CATALOG), [
    { provider: "openai", models: [MIXED_CATALOG[0], MIXED_CATALOG[2]] },
    { provider: "claude", models: [MIXED_CATALOG[1], MIXED_CATALOG[3]] }
  ]);
});

test("빈 카탈로그는 빈 그룹 목록이 된다", () => {
  assert.deepEqual(groupAiModelsByProvider([]), []);
});

test("알려진 provider는 표시 라벨로, 모르는 provider는 id 그대로 보여 준다", () => {
  assert.equal(getProviderLabel("openai"), "OpenAI");
  assert.equal(getProviderLabel("mistral"), "mistral");
});

test("모델 메뉴의 provider 행은 openai를 Chat GPT로, 나머지는 표시 라벨로 보여 준다", () => {
  assert.equal(getProviderMenuLabel("openai"), "Chat GPT");
  assert.equal(getProviderMenuLabel("claude"), "Claude");
  assert.equal(getProviderMenuLabel("mistral"), "mistral");
});
