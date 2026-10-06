/**
 * 문서·채팅 본문의 이미지 src·링크 href를 분류한다(이슈 #77).
 * 외부 주소의 이미지는 열람만으로 문서 내용(URL 쿼리)·열람자 IP가 새므로 어디서도 요청하지 않는다.
 * 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

// 백엔드가 본문 저장 응답에서 치환해 주는 관리 이미지 경로 (REQ-005)
const MANAGED_ASSET_PATH = /^\/api\/workspaces\/[^/]+\/assets\/[^/]+\/content$/;

// 상대 경로를 풀 때 쓰는 가상 오리진. 서버 렌더링과 브라우저가 같은 결과를 내도록 window.location을 쓰지 않는다.
// 그래서 우리 앱 오리진을 적은 절대 URL도 외부로 본다.
const BASE_URL = "https://fruition.invalid/";
const BASE_ORIGIN = new URL(BASE_URL).origin;

export const EXTERNAL_IMAGE_BLOCKED_MESSAGE = "보안을 위해 외부 이미지 주소는 넣을 수 없습니다. 이미지를 내려받아 직접 업로드해 주세요.";

/** 워크스페이스 멤버만 볼 수 있는 관리 이미지 경로인지. 일반 <img src>로 요청하면 401이라 JWT fetch가 필요하다. */
export function isManagedAssetPath(src: string): boolean {
  return MANAGED_ASSET_PATH.test(src);
}

export type ImageSource =
  /** 인증 fetch로 받는 관리 이미지 */
  | { kind: "managed" }
  /** 네트워크 요청이 없는 data:image·blob: */
  | { kind: "inline" }
  /** 다른 오리진. 요청하지 않고 host만 보여준다 */
  | { kind: "external"; host: string }
  /** 같은 출처라도 관리 경로가 아닌 상대 경로, 알 수 없는 스킴, 빈 값. 요청하지 않는다 */
  | { kind: "unsupported" };

function parseUrl(value: string): URL | null {
  try {
    return new URL(value, BASE_URL);
  } catch {
    return null;
  }
}

/** 이미지 src를 분류한다. `//host`·`/\host`처럼 브라우저가 다른 오리진으로 푸는 표기도 외부로 본다. */
export function classifyImageSource(src: string): ImageSource {
  if (isManagedAssetPath(src)) return { kind: "managed" };
  const url = src.trim() ? parseUrl(src.trim()) : null;
  if (!url) return { kind: "unsupported" };
  if (url.protocol === "blob:") return { kind: "inline" };
  if (url.protocol === "data:") return /^image\//i.test(url.pathname) ? { kind: "inline" } : { kind: "unsupported" };
  if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "unsupported" };
  if (url.origin !== BASE_ORIGIN) return { kind: "external", host: url.host };
  return { kind: "unsupported" };
}

/** 요청해도 되는 이미지 src인지(관리 경로·data:image·blob:). */
export function isAllowedImageSource(src: string): boolean {
  const { kind } = classifyImageSource(src);
  return kind === "managed" || kind === "inline";
}

export type LinkTarget = { external: false } | { external: true; host: string };

/** 링크가 앱 밖을 가리키는지. 상대 경로·`#`·`?`는 내부, 다른 오리진·mailto: 같은 스킴은 외부. */
export function classifyLinkHref(href: string | undefined): LinkTarget {
  if (!href) return { external: false };
  const url = parseUrl(href.trim());
  if (!url) return { external: false };
  if (url.origin === BASE_ORIGIN) return { external: false };
  return { external: true, host: url.protocol === "http:" || url.protocol === "https:" ? url.host : "" };
}

// 원문(markdown) 모드 감지용. 파서 없이 흔한 표기만 잡는다: 인라인 이미지, 참조형 이미지가 쓰는 정의, <img src>.
const INLINE_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)/g;
const REFERENCE_IMAGE = /!\[([^\]]*)\](?:\[([^\]]*)\])?/g;
const REFERENCE_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s|$)/gm;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi;

const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** markdown 본문에 들어 있는 외부 이미지 개수. 원문 모드에서 새로 넣었는지 알아차리는 데 쓴다. */
export function countExternalMarkdownImages(markdown: string): number {
  const isExternal = (src: string) => classifyImageSource(src).kind === "external";
  let count = 0;
  for (const match of markdown.matchAll(INLINE_IMAGE)) if (isExternal(match[1])) count += 1;
  for (const match of markdown.matchAll(HTML_IMAGE)) if (isExternal(match[1])) count += 1;

  const definitions = new Map<string, string>();
  for (const match of markdown.matchAll(REFERENCE_DEFINITION)) {
    const label = normalizeLabel(match[1]);
    if (!definitions.has(label)) definitions.set(label, match[2]);
  }
  if (definitions.size === 0) return count;
  for (const match of markdown.matchAll(REFERENCE_IMAGE)) {
    // 인라인 이미지 `![a](...)`는 위에서 셌다
    if (markdown[match.index + match[0].length] === "(" && match[2] === undefined) continue;
    const label = normalizeLabel(match[2] || match[1]);
    const src = definitions.get(label);
    if (src && isExternal(src)) count += 1;
  }
  return count;
}
