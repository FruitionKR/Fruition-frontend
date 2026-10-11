import assert from "node:assert/strict";
import test from "node:test";
import { parseThemePreference, resolveDataTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../src/shared/lib/theme.ts";

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
