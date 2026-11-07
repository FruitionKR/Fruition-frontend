import type { useTranslations } from "next-intl";
import { getErrorMessage } from "@/shared/lib/apiErrors";

/**
 * agentChat 메시지 번역 함수. hook을 쓸 수 없는 순수 함수는 문구를 직접 두지 않고 이 함수를 받아 문구를 만든다.
 * 화면은 useTranslations("agentChat")를, 테스트는 ko 메시지로 만든 번역 함수를 넘긴다.
 */
export type AgentChatTranslator = ReturnType<typeof useTranslations<"agentChat">>;

/** 서버가 준 상태·코드가 메시지 키를 둔 값인지. 맞으면 그 값으로 메시지 키를 만들 수 있다. */
export function isKnownKey<T extends string>(keys: readonly T[], value: string | null | undefined): value is T {
  return value !== null && value !== undefined && (keys as readonly string[]).includes(value);
}

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
export function agentChatErrorMessage(error: unknown, fallback: string, t: AgentChatTranslator): string {
  return error instanceof AgentChatError ? t(`errors.${error.key}`) : getErrorMessage(error, fallback);
}
