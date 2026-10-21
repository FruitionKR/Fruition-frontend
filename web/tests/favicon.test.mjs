import assert from "node:assert/strict";
import test from "node:test";
import { FAVICON_LINKS, faviconHref, watchFaviconScheme } from "../src/shared/lib/favicon.ts";

test("탭 아이콘 주소는 색 구성·형식별 고정 파일이고 캐시를 넘길 버전 쿼리가 붙는다", () => {
  assert.match(faviconHref("light", "svg"), /^\/favicon\/icon-light\.svg\?v=\w+$/);
  assert.match(faviconHref("dark", "png"), /^\/favicon\/icon-dark\.png\?v=\w+$/);
});

test("첫 화면 link는 OS·브라우저 색 구성(media)별로 SVG·PNG를 하나씩 둔다", () => {
  for (const scheme of ["light", "dark"]) {
    const links = FAVICON_LINKS.filter((link) => link.media === `(prefers-color-scheme: ${scheme})`);
    assert.deepEqual(links.map((link) => link.format).sort(), ["png", "svg"]);
    for (const link of links) assert.equal(link.href, faviconHref(scheme, link.format));
  }
});

/** 첫 화면 link를 흉내 낸 가짜 link와 matchMedia 위에서 감시를 시작하고, 색 구성을 바꿔 볼 수 있게 한다. */
function startWatch(initialDark) {
  let listeners = [];
  const query = {
    matches: initialDark,
    addEventListener: (type, fn) => type === "change" && listeners.push(fn),
    removeEventListener: (type, fn) => { listeners = listeners.filter((l) => l !== fn); }
  };
  let sets = 0;
  const links = FAVICON_LINKS.map((link) => {
    const attrs = { href: link.href, media: link.media };
    return {
      get href() { return attrs.href; },
      set href(value) { sets += 1; attrs.href = value; },
      dataset: { favicon: link.format },
      getAttribute: (name) => attrs[name] ?? null,
      removeAttribute: (name) => { delete attrs[name]; }
    };
  });
  const stop = watchFaviconScheme(query, () => links);
  const change = (dark) => {
    query.matches = dark;
    for (const fn of listeners) fn();
  };
  return { links, change, stop, sets: () => sets };
}

const allPointTo = (links, scheme) => links.every((link) => link.href === faviconHref(scheme, link.dataset.favicon));

test("감시를 시작하면 지금 색 구성에 맞는 파일로 모든 아이콘 link를 맞추고 media를 뗀다", () => {
  const { links } = startWatch(true);
  assert.ok(allPointTo(links, "dark"));
  assert.ok(links.every((link) => link.getAttribute("media") === null));
});

test("OS·브라우저 색 구성이 바뀌면 다시 불러오지 않아도 아이콘 주소가 바로 바뀐다", () => {
  const { links, change } = startWatch(false);
  assert.ok(allPointTo(links, "light"));
  change(true);
  assert.ok(allPointTo(links, "dark"));
  change(false);
  assert.ok(allPointTo(links, "light"));
});

test("이미 맞는 주소인 link는 다시 넣지 않아 아이콘을 또 받지 않는다", () => {
  const { sets } = startWatch(false);
  // 라이트 link 둘은 그대로, 다크 link 둘만 라이트 파일로 바뀐다
  assert.equal(sets(), 2);
});

test("정리하면 색 구성이 바뀌어도 더는 아이콘을 바꾸지 않는다", () => {
  const { links, change, stop } = startWatch(false);
  stop();
  change(true);
  assert.ok(allPointTo(links, "light"));
});
