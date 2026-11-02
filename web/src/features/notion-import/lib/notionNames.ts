/**
 * Notion 내보내기 파일·폴더 이름 정리. 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

// Notion은 이름 끝에 " <32자리 hex id>"를 붙인다. 확장자 앞이나 이름 끝에 온다.
const NOTION_ID_SUFFIX = /\s[0-9a-f]{32}$/i;

/** 경로 조각 하나에서 확장자를 뗀 이름과 확장자(소문자, 점 포함)를 나눈다. */
export function splitExtension(segment: string): { base: string; extension: string } {
  const dot = segment.lastIndexOf(".");
  if (dot <= 0) return { base: segment, extension: "" };
  return { base: segment.slice(0, dot), extension: segment.slice(dot).toLowerCase() };
}

/** ` <32 hex>` 꼬리를 떼고 NFC로 정규화한다. 비면 "제목 없음". */
export function cleanNotionName(base: string): string {
  const cleaned = base.normalize("NFC").replace(NOTION_ID_SUFFIX, "").trim();
  return cleaned || "제목 없음";
}

/** 비교용 키: 서버처럼 앞뒤 공백을 빼고 NFC·소문자로 비교한다. */
export function nameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

/**
 * 한 폴더 안에서 같은 이름을 피한다. 이미 쓰인 이름이면 ` (2)`, ` (3)`…을 붙인다.
 * taken은 호출자가 소유한 집합이며 고른 이름을 넣어 둔다.
 */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let number = 2; taken.has(nameKey(candidate)); number += 1) candidate = `${name} (${number})`;
  taken.add(nameKey(candidate));
  return candidate;
}
