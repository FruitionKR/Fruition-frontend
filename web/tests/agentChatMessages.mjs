// 채팅·에이전트 영역 테스트용 번역 도우미. 화면과 같이 agentChat 메시지를 한국어(ko)로 풀어 문구까지 확인한다.
// hook을 그대로 렌더하는 테스트는 "next-intl"을 이 파일로 바꿔 useTranslations를 쓴다.
import { readFileSync } from "node:fs";
import { createTranslator } from "use-intl/core";

export const koAgentChat = JSON.parse(readFileSync(new URL("../src/shared/i18n/messages/ko/agentChat.json", import.meta.url), "utf8"));

/** agentChat 네임스페이스의 한국어 번역 함수(useTranslations("agentChat")와 같은 모양). */
export const agentChatT = createTranslator({ locale: "ko", messages: { agentChat: koAgentChat }, namespace: "agentChat", timeZone: "Asia/Seoul" });

const translators = new Map();

/** next-intl 대역. 네임스페이스별로 같은 함수를 돌려줘 hook 의존성이 매 렌더 바뀌지 않게 한다. */
export function useTranslations(namespace = "agentChat") {
  if (!translators.has(namespace)) {
    translators.set(namespace, namespace === "agentChat" ? agentChatT : createTranslator({ locale: "ko", messages: { agentChat: koAgentChat }, namespace, timeZone: "Asia/Seoul" }));
  }
  return translators.get(namespace);
}
