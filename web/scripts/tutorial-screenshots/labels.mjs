// 화면 문구를 언어별로 찾는다. 캡처 정의는 한국어 문구로 쓰고, 영어 화면에서는 같은 메시지 키의 영어 문구로 바꿔 찾는다.
// 메시지 파일(src/shared/i18n/messages/{ko,en})을 그대로 읽어 화면 문구가 바뀌어도 정의를 고칠 필요가 없게 한다.
import { readdirSync, readFileSync } from "node:fs";

const MESSAGES_DIR = new URL("../../src/shared/i18n/messages/", import.meta.url);

function loadMessages(locale) {
  const dir = new URL(`${locale}/`, MESSAGES_DIR);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(new URL(name, dir), "utf8"))])
  );
}

function flatten(node, path = []) {
  if (typeof node === "string") return [[path, node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, child]) => flatten(child, [...path, key]));
}

/** 화면 문구가 아닌 네임스페이스(랜딩 소개·튜토리얼 본문·메타데이터)는 찾지 않는다. */
const SKIPPED_NAMESPACES = new Set(["landing", "tutorialContent", "metadata"]);

const pick = (node, path) => path.reduce((value, key) => value?.[key], node);

/**
 * locale 화면 문구를 돌려주는 함수를 만든다. 한국어 문구(자리표시자 포함)를 키로 찾고 {name} 자리는 values로 채운다.
 * 같은 한국어 문구가 여러 키에 있고 영어가 다르면 keyHint(키 경로 일부, 예: "rail")로 고른다.
 */
export function createLabeler(locale) {
  const ko = loadMessages("ko");
  const target = locale === "ko" ? ko : loadMessages(locale);
  const pathsByKo = new Map();
  for (const [path, value] of flatten(ko)) {
    if (SKIPPED_NAMESPACES.has(path[0])) continue;
    if (!pathsByKo.has(value)) pathsByKo.set(value, []);
    pathsByKo.get(value).push(path);
  }

  return function label(koText, values = {}, keyHint) {
    const found = pathsByKo.get(koText);
    const paths = keyHint ? found?.filter((path) => path.join(".").includes(keyHint)) : found;
    if (!paths) throw new Error(`ko 메시지에 없는 문구: ${koText}`);
    const translated = paths.map((path) => pick(target, path)).find((value) => typeof value === "string");
    if (!translated) throw new Error(`${locale} 메시지에 없는 문구: ${koText}`);
    return translated.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
  };
}
