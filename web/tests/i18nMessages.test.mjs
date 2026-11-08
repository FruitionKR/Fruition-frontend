import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const MESSAGES_DIR = new URL("../src/shared/i18n/messages/", import.meta.url);
const LOCALES = ["ko", "en"];

const namespaces = (locale) => readdirSync(new URL(`${locale}/`, MESSAGES_DIR)).filter((name) => name.endsWith(".json")).sort();
const load = (locale, file) => JSON.parse(readFileSync(new URL(`${locale}/${file}`, MESSAGES_DIR), "utf8"));

/** 중첩 객체를 "a.b.c" 키 목록으로 펼친다. 배열은 쓰지 않는다(키로 찾을 수 있게 객체로 둔다). */
function flatten(value, prefix = "") {
  if (Array.isArray(value)) throw new Error(`${prefix}: 메시지에 배열 대신 키가 있는 객체를 쓴다`);
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

/** ICU 자리표시자 이름({name}, {count, plural, ...}의 count). */
function placeholders(text) {
  return [...text.matchAll(/\{\s*([A-Za-z0-9_]+)\s*(?:,|\})/g)].map((match) => match[1]).sort();
}

test("언어마다 같은 네임스페이스 파일이 있다", () => {
  assert.deepEqual(namespaces("en"), namespaces("ko"));
});

for (const file of namespaces("ko")) {
  test(`${file}: ko·en 메시지 키가 빠짐없이 같다`, () => {
    const [ko, en] = LOCALES.map((locale) => flatten(load(locale, file)).sort());
    assert.deepEqual(en.filter((key) => !ko.includes(key)), [], "en에만 있는 키");
    assert.deepEqual(ko.filter((key) => !en.includes(key)), [], "ko에만 있는 키");
  });

  test(`${file}: 문구는 비어 있지 않고 자리표시자가 같다`, () => {
    const [ko, en] = LOCALES.map((locale) => load(locale, file));
    const get = (object, key) => key.split(".").reduce((value, part) => value[part], object);
    for (const key of flatten(ko)) {
      const [koText, enText] = [get(ko, key), get(en, key)];
      assert.equal(typeof enText, "string", key);
      assert.ok(koText.trim() && enText.trim(), `${key} 비어 있음`);
      assert.deepEqual(new Set(placeholders(enText)), new Set(placeholders(koText)), `${key} 자리표시자`);
    }
  });
}

test("메시지 색인이 모든 네임스페이스를 두 언어 모두에 싣는다", () => {
  const index = readFileSync(new URL("index.ts", MESSAGES_DIR), "utf8");
  for (const locale of LOCALES) {
    for (const file of namespaces(locale)) assert.match(index, new RegExp(`from "\\./${locale}/${file.replace(".", "\\.")}"`), `${locale}/${file}`);
  }
});
