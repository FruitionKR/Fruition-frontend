import { getErrorMessage } from "@/shared/lib/apiErrors";
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";
import type { AgentChatTranslator } from "./agentChatTranslator";

/** 화면이 번역해 보여 줄 오류의 agentChat.errors 아래 메시지 키 */
export type AgentChatErrorKey = "planRequestFailed" | "planMissing" | "invalidSelection";

/**
 * 번역 함수가 없는 API 계층이 던지는 오류. message는 한국어 원문(로그·테스트용)이고, 화면은 key로 현재 언어 문구를 보여 준다.
 */
export class AgentChatError extends Error {
  readonly key: AgentChatErrorKey;

  constructor(key: AgentChatErrorKey, message: string) {
    super(message);
    this.name = "AgentChatError";
    this.key = key;
  }
}

/** 오류를 화면 문구로 바꾼다. AgentChatError는 현재 언어로, 나머지는 getErrorMessage(서버 문구·fallback)로 바꾼다. */
export function agentChatErrorMessage(error: unknown, fallback: string, t: AgentChatTranslator, tShared?: SharedTranslate): string {
  return error instanceof AgentChatError ? t(`errors.${error.key}`) : getErrorMessage(error, fallback, tShared);
}
