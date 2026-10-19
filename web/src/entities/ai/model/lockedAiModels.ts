import type { AiModel } from "./aiModel";

/**
 * 저가 모델 정책(2026-10-18)으로 백엔드 카탈로그에서 빠진 모델. 화면에 잠금으로만 보여 주며 선택할 수 없다.
 * 이름·순서는 정책 이전 백엔드 AiModelCatalog(Fruition-document dev 9ca615b, PR #149 머지 직전)에서 허용 3개를 뺀 것이다.
 * 백엔드가 다시 돌려주는 모델은 자동으로 선택 가능해진다.
 */
export const LOCKED_AI_MODELS: readonly AiModel[] = [
  { provider: "openai", model: "gpt-6.1-sol", display_name: "GPT-6.1 Sol" },
  { provider: "openai", model: "gpt-6-sol", display_name: "GPT-6 Sol" },
  { provider: "openai", model: "gpt-6-astra", display_name: "GPT-6 Astra" },
  { provider: "openai", model: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" },
  { provider: "openai", model: "gpt-5.6-terra", display_name: "GPT-5.6 Terra" },
  { provider: "openai", model: "gpt-5.6-luna", display_name: "GPT-5.6 Luna" },
  { provider: "openai", model: "gpt-5.5", display_name: "GPT-5.5" },
  { provider: "openai", model: "gpt-5.4", display_name: "GPT-5.4" },
  { provider: "openai", model: "gpt-5.4-mini", display_name: "GPT-5.4 Mini" },
  { provider: "openai", model: "gpt-4.1", display_name: "GPT-4.1" },
  { provider: "openai", model: "gpt-4.1-mini", display_name: "GPT-4.1 Mini" },
  { provider: "openai", model: "gpt-4o", display_name: "GPT-4o" },
  { provider: "openai", model: "gpt-4o-mini", display_name: "GPT-4o Mini" },
  { provider: "gemini", model: "gemini-3.8-flash", display_name: "Gemini 3.8 Flash" },
  { provider: "gemini", model: "gemini-3.6-flash", display_name: "Gemini 3.6 Flash" },
  { provider: "gemini", model: "gemini-3.1-pro-preview", display_name: "Gemini 3.1 Pro preview" },
  { provider: "gemini", model: "gemini-3-flash-preview", display_name: "Gemini 3 Flash preview" },
  { provider: "claude", model: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
  { provider: "claude", model: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
  { provider: "claude", model: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
  { provider: "claude", model: "claude-fable-5-1", display_name: "Claude Fable 5.1" },
  { provider: "claude", model: "claude-opus-5", display_name: "Claude Opus 5" },
  { provider: "claude", model: "claude-fable-5", display_name: "Claude Fable 5" },
  { provider: "claude", model: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
  { provider: "claude", model: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" }
];
