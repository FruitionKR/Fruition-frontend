import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatModelOptions,
  buildWorkspaceModelOptions,
  getAiModelLockMessage,
  groupAiModelsByProvider,
  isProviderLocked
} from "../src/entities/ai/model/aiModel.ts";
import { LOCKED_AI_MODELS } from "../src/entities/ai/model/lockedAiModels.ts";

// 저가 모델 정책 카탈로그(3개).
const POLICY_CATALOG = [
  { provider: "openai", model: "gpt-6-luna", display_name: "GPT-6 Luna" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", display_name: "Gemini 3.5 Flash-Lite" },
  { provider: "claude", model: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" }
];

const key = (item) => `${item.provider}/${item.model}`;

test("잠금 목록은 정책 이전 백엔드 카탈로그(28개)에서 허용 3개를 뺀 25개다", () => {
  const counts = {};
  for (const item of LOCKED_AI_MODELS) counts[item.provider] = (counts[item.provider] ?? 0) + 1;
  assert.deepEqual(counts, { openai: 13, gemini: 4, claude: 8 });
});

test("잠금 목록에는 정책 카탈로그 모델이 없고 중복도 없다", () => {
  const keys = LOCKED_AI_MODELS.map(key);
  assert.equal(new Set(keys).size, keys.length);
  for (const model of POLICY_CATALOG) assert.equal(keys.includes(key(model)), false);
});

test("채팅 목록: 카탈로그 모델은 선택 가능, 나머지는 비용 정책 잠금이며 provider 안에서 선택 가능 모델이 먼저 온다", () => {
  const options = buildChatModelOptions(POLICY_CATALOG, LOCKED_AI_MODELS);
  assert.equal(options.length, POLICY_CATALOG.length + LOCKED_AI_MODELS.length);
  const unlocked = options.filter((item) => item.lockReason === null).map(key);
  assert.deepEqual(unlocked, POLICY_CATALOG.map(key));
  assert.ok(options.filter((item) => item.lockReason !== null).every((item) => item.lockReason === "cost_policy"));
  const groups = groupAiModelsByProvider(options);
  assert.deepEqual(groups.map((group) => group.provider), ["openai", "gemini", "claude"]);
  for (const group of groups) {
    assert.equal(group.models[0].lockReason, null);
    assert.equal(isProviderLocked(group.models), false);
  }
});

test("백엔드가 잠금 모델을 다시 돌려주면 그 모델은 자동으로 선택 가능해진다", () => {
  const restored = { provider: "claude", model: "claude-sonnet-5", display_name: "Claude Sonnet 5" };
  const options = buildChatModelOptions([...POLICY_CATALOG, restored], LOCKED_AI_MODELS);
  const matches = options.filter((item) => key(item) === key(restored));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].lockReason, null);
});

test("카탈로그에 없는 provider의 모델은 모두 잠겨 provider도 잠금이 된다", () => {
  const options = buildChatModelOptions(POLICY_CATALOG.slice(0, 2), LOCKED_AI_MODELS);
  const claude = groupAiModelsByProvider(options).find((group) => group.provider === "claude");
  assert.ok(claude);
  assert.equal(isProviderLocked(claude.models), true);
});

test("카탈로그를 아직 받지 못했으면 잠금 모델도 보여 주지 않는다", () => {
  assert.deepEqual(buildChatModelOptions([], LOCKED_AI_MODELS), []);
  assert.equal(isProviderLocked([]), false);
});

test("워크스페이스 목록: Claude는 카탈로그 모델까지 모두 Claude 안내로 잠기고, 나머지는 채팅 목록과 같다", () => {
  const options = buildWorkspaceModelOptions(POLICY_CATALOG, LOCKED_AI_MODELS);
  const claude = options.filter((item) => item.provider === "claude");
  assert.ok(claude.length > 1);
  assert.ok(claude.every((item) => item.lockReason === "workspace_claude"));
  const others = options.filter((item) => item.provider !== "claude");
  assert.deepEqual(
    others.filter((item) => item.lockReason === null).map(key),
    ["openai/gpt-6-luna", "gemini/gemini-3.5-flash-lite"]
  );
  assert.ok(others.filter((item) => item.lockReason !== null).every((item) => item.lockReason === "cost_policy"));
});

test("잠금 사유 문구", () => {
  assert.equal(getAiModelLockMessage("cost_policy"), "비용 정책으로 사용할 수 없는 모델");
  assert.equal(getAiModelLockMessage("workspace_claude"), "Claude 모델은 채팅에서 직접 선택할 때만 사용할 수 있습니다.");
});
