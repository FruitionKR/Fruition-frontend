// 테스트에서 화면 문구를 한국어 메시지 JSON으로 확인한다. 컴포넌트를 직접 그리는 테스트는 nextIntlMock을 "next-intl" 대신 넘긴다.
import { readdirSync, readFileSync } from "node:fs";
import { createTranslator } from "use-intl/core";

const MESSAGES_DIR = new URL("../src/shared/i18n/messages/ko/", import.meta.url);

/** ko 메시지 전체(네임스페이스 → JSON) */
export const koMessages = Object.fromEntries(
  readdirSync(MESSAGES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(name, MESSAGES_DIR), "utf8"))])
);

/** useTranslations와 같은 한국어 번역 함수 */
export function koT(namespace) {
  return createTranslator({ locale: "ko", messages: koMessages, namespace });
}

/** "next-intl" 모듈 대역. useTranslations·useMessages만 쓴다. */
export const nextIntlMock = {
  useTranslations: (namespace) => koT(namespace),
  useMessages: () => koMessages
};
