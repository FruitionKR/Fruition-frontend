import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderLabel,
  getProviderMenuLabel,
  groupAiModelsByProvider,
  isSameSelection,
  resolveInitialModel
} from "../src/entities/ai/model/aiModel.ts";

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
