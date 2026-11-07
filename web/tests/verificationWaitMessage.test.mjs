import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";

const { verificationWaitMessage } = await import("../src/views/auth/lib/verificationWaitMessage.ts");
const load = (locale) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/messages/${locale}/auth.json`, import.meta.url), "utf8"));
const render = (locale, seconds) => {
  const { key, values } = verificationWaitMessage(seconds);
  return new IntlMessageFormat(load(locale).verification.wait[key], locale).format(values);
};

test("시도 제한 대기 시간을 초·분(올림)·시간 단위로 나눈다", () => {
  assert.deepEqual(verificationWaitMessage(45), { key: "seconds", values: { seconds: 45 } });
  assert.deepEqual(verificationWaitMessage(61), { key: "minutes", values: { minutes: 2 } });
  assert.deepEqual(verificationWaitMessage(3600), { key: "hours", values: { hours: 1 } });
  assert.deepEqual(verificationWaitMessage(3900), { key: "hoursMinutes", values: { hours: 1, minutes: 5 } });
});

test("대기 문구는 언어별 메시지로 그린다", () => {
  assert.equal(render("ko", 45), "인증 요청이 너무 잦아요. 45초 후 다시 시도해 주세요.");
  assert.equal(render("ko", 3900), "인증 요청이 너무 잦아요. 1시간 5분 후 다시 시도해 주세요.");
  assert.equal(render("en", 1), "Too many verification requests. Try again in 1 second.");
  assert.equal(render("en", 3900), "Too many verification requests. Try again in 1 hour 5 minutes.");
});
