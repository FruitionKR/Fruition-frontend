import { readdirSync, readFileSync } from "node:fs";
import { createTranslator } from "use-intl/core";

// 테스트에서 실제 메시지 JSON으로 next-intl 번역 함수를 만든다. 화면과 같은 ICU 처리(복수형·날짜)를 쓴다.
const MESSAGES_DIR = new URL("../../src/shared/i18n/messages/", import.meta.url);

/** 언어의 전체 메시지(네임스페이스별 JSON). */
export function loadMessages(locale) {
  const dir = new URL(`${locale}/`, MESSAGES_DIR);
  return Object.fromEntries(
    readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(name, dir), "utf8"))])
  );
}

/** request.ts와 같은 시간대(Asia/Seoul)의 번역 함수. namespace는 "shared"처럼 넘긴다. */
export function translator(locale, namespace) {
  return createTranslator({ locale, messages: loadMessages(locale), namespace, timeZone: "Asia/Seoul" });
}

/** 컴포넌트를 vm으로 불러올 때 "next-intl" 대신 넘기는 모듈. useTranslations만 실제 메시지로 동작한다. */
export function fakeNextIntl(locale = "ko") {
  return { useTranslations: (namespace) => translator(locale, namespace) };
}
