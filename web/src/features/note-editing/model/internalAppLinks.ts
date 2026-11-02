/**
 * 편집기 안 링크 중 앱 문서·위키 페이지 주소(`/home?doc=…`·`/home?page=…`)를 가려 앱 안에서 연다.
 * 외부 링크는 지금처럼 링크 툴팁의 주소(새 탭, rel=noopener)로만 연다.
 * 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

/** 앱 안에서 열 경로 */
const APP_DOCUMENT_PATH = "/home";

/**
 * 앱 안에서 열 주소면 `경로?쿼리#해시`를, 아니면 null을 돌려준다.
 * 상대 경로(`/home?doc=…`)와 이 앱 오리진의 절대 주소만 받는다. `//host`·`/\host` 같은 다른 오리진 표기는 거른다.
 */
export function internalAppHref(href: string | null | undefined, origin: string): string | null {
  const raw = href?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== APP_DOCUMENT_PATH) return null;
  if (!url.searchParams.has("doc") && !url.searchParams.has("page")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 편집기 본문 링크를 앱 안에서 여는 클릭인지: 왼쪽 버튼 + Cmd/Ctrl(Shift·Alt 없이). 그냥 클릭은 편집용이다. */
export function shouldOpenInApp(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}
