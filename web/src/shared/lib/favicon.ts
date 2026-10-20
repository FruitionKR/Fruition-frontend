/**
 * 탭 아이콘(favicon). 탭 띠 배경은 앱 테마(data-theme)가 아니라 OS·브라우저 색 구성을 따르므로
 * 아이콘도 prefers-color-scheme 기준으로 고른다. 라이트는 검정, 다크는 흰 글리프 파일을 따로 둔다.
 * SVG 안의 미디어쿼리는 Chrome이 처음 한 번만 평가해 OS 테마를 바꿔도 이전 색이 남기 때문이다.
 */
export type FaviconScheme = "light" | "dark";
export type FaviconFormat = "svg" | "png";

/** 아이콘 그림을 바꾸면 올려 브라우저가 캐시한 이전 아이콘을 버리게 한다. */
const FAVICON_VERSION = "2";
export const FAVICON_DARK_QUERY = "(prefers-color-scheme: dark)";

export function faviconHref(scheme: FaviconScheme, format: FaviconFormat): string {
  return `/favicon/icon-${scheme}.${format}?v=${FAVICON_VERSION}`;
}

const FAVICON_TYPES: Record<FaviconFormat, { type: string; sizes: string }> = {
  svg: { type: "image/svg+xml", sizes: "any" },
  png: { type: "image/png", sizes: "300x300" }
};

/** 첫 화면 link. media를 지원하는 브라우저는 스크립트 없이도 맞는 색을 고른다. */
export const FAVICON_LINKS = (["light", "dark"] as const).flatMap((scheme) =>
  (["svg", "png"] as const).map((format) => ({
    format,
    href: faviconHref(scheme, format),
    media: `(prefers-color-scheme: ${scheme})`,
    ...FAVICON_TYPES[format]
  }))
);

/** 아이콘 link가 쓰는 DOM 표면. 테스트에서 가짜 객체로 바꿀 수 있게 필요한 것만 둔다. */
type FaviconLink = { href: string; dataset: DOMStringMap; getAttribute(name: string): string | null; removeAttribute(name: string): void };

/** 모든 아이콘 link를 고른 색 구성 파일로 맞추고, 첫 화면용 media를 뗀다. */
export function syncFavicons(links: Iterable<FaviconLink>, scheme: FaviconScheme) {
  for (const link of links) {
    const format = link.dataset.favicon === "png" ? "png" : "svg";
    link.removeAttribute("media");
    const href = faviconHref(scheme, format);
    // 같은 주소를 다시 넣으면 브라우저가 아이콘을 또 받으므로 바뀔 때만 넣는다.
    if (link.getAttribute("href") !== href) link.href = href;
  }
}

type SchemeQuery = { matches: boolean; addEventListener(type: "change", fn: () => void): void; removeEventListener(type: "change", fn: () => void): void };

/**
 * 지금 OS·브라우저 색 구성으로 아이콘을 맞추고, 바뀌면(change) 바로 다시 맞춘다. 정리 함수를 돌려준다.
 * hydration 뒤에 실행해야 한다. React는 head link를 href로 짝지어 hydration하므로, 그 전에 href를 바꾸면
 * 원래 link를 다시 넣어 아이콘이 둘씩 생긴다.
 */
export function watchFaviconScheme(query: SchemeQuery, getLinks: () => Iterable<FaviconLink>): () => void {
  const sync = () => syncFavicons(getLinks(), query.matches ? "dark" : "light");
  sync();
  query.addEventListener("change", sync);
  return () => query.removeEventListener("change", sync);
}
