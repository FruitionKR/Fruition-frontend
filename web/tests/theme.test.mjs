import assert from "node:assert/strict";
import test from "node:test";
import { applyThemePreference, isDarkTheme, parseThemePreference, resolveDataTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../src/shared/lib/themePreference.ts";

test("저장된 테마 문자열은 system·light·dark만 통과시키고 나머지는 system이다", () => {
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("system"), "system");
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("blue"), "system");
});

test("OS에 맞춤이면 data-theme을 두지 않고, 고른 테마는 그대로 붙인다", () => {
  assert.equal(resolveDataTheme("system"), null);
  assert.equal(resolveDataTheme("light"), "light");
  assert.equal(resolveDataTheme("dark"), "dark");
});

test("첫 화면 스크립트는 같은 저장 키를 읽고 light·dark만 data-theme으로 붙인다", () => {
  assert.match(THEME_INIT_SCRIPT, new RegExp(THEME_STORAGE_KEY.replaceAll(".", "\\.")));
  const root = { dataset: {} };
  const run = (stored) => {
    root.dataset = {};
    new Function("document", "localStorage", THEME_INIT_SCRIPT)(
      { documentElement: root },
      { getItem: () => stored }
    );
    return root.dataset.theme;
  };
  assert.equal(run("dark"), "dark");
  assert.equal(run("light"), "light");
  assert.equal(run("system"), undefined);
  assert.equal(run("<script>"), undefined);
});

/** document·window를 잠시 가짜로 바꿔 테마 적용 결과를 본다. */
function withFakeDom({ prefersDark = false, storageThrows = false } = {}, run) {
  const saved = { document: globalThis.document, window: globalThis.window };
  const store = new Map();
  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.window = {
    localStorage: {
      setItem: (key, value) => {
        if (storageThrows) throw new Error("blocked");
        store.set(key, value);
      }
    },
    matchMedia: () => ({ matches: prefersDark })
  };
  try {
    return run({ root: globalThis.document.documentElement, store });
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
}

test("고른 테마를 data-theme에 붙이고 다음 첫 화면용으로 저장한다. system이면 속성을 지운다", () => {
  withFakeDom({}, ({ root, store }) => {
    applyThemePreference("dark");
    assert.equal(root.dataset.theme, "dark");
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(isDarkTheme(), true);

    applyThemePreference("system");
    assert.equal("theme" in root.dataset, false);
    assert.equal(store.get(THEME_STORAGE_KEY), "system");
  });
});

test("system이면 OS 설정으로 다크 여부를 정하고, 저장소를 못 써도 이번 화면에는 적용한다", () => {
  withFakeDom({ prefersDark: true, storageThrows: true }, ({ root }) => {
    applyThemePreference("system");
    assert.equal(isDarkTheme(), true);
    applyThemePreference("light");
    assert.equal(root.dataset.theme, "light");
    assert.equal(isDarkTheme(), false);
  });
});
