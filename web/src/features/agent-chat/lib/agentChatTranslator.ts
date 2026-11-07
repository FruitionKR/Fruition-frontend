import type { useTranslations } from "next-intl";

/**
 * agentChat 메시지 번역 함수. hook을 쓸 수 없는 순수 함수는 문구를 직접 두지 않고 이 함수를 받아 문구를 만든다.
 * 화면은 useTranslations("agentChat")를, 테스트는 ko 메시지로 만든 번역 함수를 넘긴다.
 * 테스트가 직접 import하는 순수 함수들이 가져오므로 다른 모듈을 import하지 않는다(타입만 가져온다).
 */
export type AgentChatTranslator = ReturnType<typeof useTranslations<"agentChat">>;

/** 서버가 준 상태·코드가 메시지 키를 둔 값인지. 맞으면 그 값으로 메시지 키를 만들 수 있다. */
export function isKnownKey<T extends string>(keys: readonly T[], value: string | null | undefined): value is T {
  return value !== null && value !== undefined && (keys as readonly string[]).includes(value);
}
