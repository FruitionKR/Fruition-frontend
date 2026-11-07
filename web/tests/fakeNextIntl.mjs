// 훅 테스트용 next-intl 대역. 실제 next-intl은 React Provider가 있어야 해 reactHookShim으로 렌더하는 훅에서 쓸 수 없다.
// ko 메시지 JSON을 읽어 ICU 문구를 만든다(next-intl과 같은 intl-messageformat). 테스트는 한국어 문구로 같은 의도를 확인한다.
import { readdirSync, readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";

const KO_DIR = new URL("../src/shared/i18n/messages/ko/", import.meta.url);

export const koMessages = Object.fromEntries(
  readdirSync(KO_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(new URL(name, KO_DIR), "utf8"))])
);

/** "a.b.c" 경로의 ko 문구를 values로 채운다. 없는 키는 next-intl처럼 키를 그대로 돌려주지 않고 바로 실패시킨다. */
export function ko(key, values) {
  const message = key.split(".").reduce((node, part) => node?.[part], koMessages);
  if (typeof message !== "string") throw new Error(`ko 메시지가 없다: ${key}`);
  return String(new IntlMessageFormat(message, "ko").format(values));
}

const translators = new Map();

/** React의 useTranslations처럼 네임스페이스마다 같은 함수를 돌려준다(deps가 바뀌지 않게). */
export function useTranslations(namespace) {
  if (!translators.has(namespace)) translators.set(namespace, (key, values) => ko(namespace ? `${namespace}.${key}` : key, values));
  return translators.get(namespace);
}

/** useMessages 대역. 컴포넌트가 문구를 그대로 쓸 때(편집기 라벨 등) ko 메시지 전체를 돌려준다. */
export function useMessages() {
  return koMessages;
}
