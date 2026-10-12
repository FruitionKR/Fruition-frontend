/** 화면 테마 설정. system이면 OS 설정(prefers-color-scheme)을 따른다. */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * 마지막으로 고른 테마. 사용자별 설정은 /me를 받은 뒤에야 읽을 수 있어,
 * 첫 화면을 그리기 전에 적용할 수 있도록 사용자와 무관한 키에도 같이 둔다.
 */
export const THEME_STORAGE_KEY = "fruition.theme";

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === "string" && THEME_PREFERENCES.includes(value as ThemePreference)
    ? value as ThemePreference
    : "system";
}

/** html[data-theme]에 붙일 값. system이면 속성을 두지 않아 CSS가 OS 설정을 따른다. */
export function resolveDataTheme(preference: ThemePreference): "light" | "dark" | null {
  return preference === "system" ? null : preference;
}

/** 고른 테마를 문서에 적용하고, 다음 첫 화면을 위해 저장해 둔다. */
export function applyThemePreference(preference: ThemePreference) {
  const dataTheme = resolveDataTheme(preference);
  if (dataTheme) document.documentElement.dataset.theme = dataTheme;
  else delete document.documentElement.dataset.theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 저장소를 못 쓰면 이번 화면에만 적용한다.
  }
}

/** 지금 화면이 다크 테마인지. 캔버스처럼 CSS 변수를 못 쓰는 곳에서 팔레트를 고를 때 쓴다. */
export function isDarkTheme(): boolean {
  if (typeof window === "undefined") return false;
  const dataTheme = document.documentElement.dataset.theme;
  if (dataTheme === "dark") return true;
  if (dataTheme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * 첫 화면을 그리기 전에 실행하는 인라인 스크립트(app/layout.tsx).
 * 반대 테마로 잠깐 그려졌다 바뀌는 깜빡임을 막는다. 저장 값이 light·dark일 때만 속성을 붙인다.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
