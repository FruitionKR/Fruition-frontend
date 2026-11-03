/**
 * Markdown 안 상대 링크·이미지 주소를 묶음(zip·함께 고른 파일) 안 경로로 푼다. Notion 가져오기와 Markdown 업로드가 같이 쓴다.
 * 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 파일 경로의 폴더 부분("a/b/c.md" → "a/b") */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * 문서 안 링크를 zip 안 경로로 푼다. 외부 주소·같은 문서 앵커·zip 밖으로 나가는 경로는 null.
 * `#앵커`와 `?query`는 버린다(앱은 문서 안 블록 위치로 이동하지 않는다).
 */
export function resolveRelativeLink(fromPath: string, href: string): string | null {
  const raw = href.trim().replace(/^<|>$/g, "");
  if (!raw || raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("\\") || SCHEME.test(raw)) return null;
  const withoutFragment = raw.replace(/[#?].*$/, "");
  if (!withoutFragment) return null;
  const segments = dirname(fromPath).split("/").filter(Boolean);
  for (const segment of safeDecode(withoutFragment).normalize("NFC").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}
