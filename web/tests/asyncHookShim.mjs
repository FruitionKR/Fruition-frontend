// 폴링 훅 테스트용 react shim. reactHookShim 위에 deps 기반 memo와 useSyncExternalStore를 더한다.
// 기본 shim의 useCallback은 렌더마다 새 함수를 돌려줘, 콜백을 deps로 둔 effect가 매 rerender마다 다시 돌아
// 폴링 횟수를 셀 수 없다. 여기서는 React처럼 deps가 같으면 같은 값을 돌려준다.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, useEffect, useRef, useState } from "./reactHookShim.mjs";

export { render, useEffect, useRef, useState };

function sameDeps(previous, next) {
  return Boolean(previous && next) && previous.length === next.length
    && next.every((dep, index) => Object.is(dep, previous[index]));
}

export function useCallback(callback, deps) {
  const ref = useRef(null);
  if (!ref.current || !sameDeps(ref.current.deps, deps)) ref.current = { value: callback, deps };
  return ref.current.value;
}

export function useMemo(factory, deps) {
  const ref = useRef(null);
  if (!ref.current || !sameDeps(ref.current.deps, deps)) ref.current = { value: factory(), deps };
  return ref.current.value;
}

// 구독만 유지하고 스냅샷은 렌더마다 읽는다. 변경 후에는 테스트가 rerender()를 호출한다.
export function useSyncExternalStore(subscribe, getSnapshot) {
  useEffect(() => subscribe(() => {}), [subscribe]);
  return getSnapshot();
}

/** 사용자 설정 Provider 대신 쓰는 값. 테스트가 notifications를 바꿔 알림 설정 분기를 확인한다. */
export const fakeUserPreferences = {
  preferences: { notifications: { query: true, suggest: true } }
};

export function useUserPreferences() {
  return fakeUserPreferences;
}

/** 앱 경로 별칭을 소스로, react는 이 shim으로, 지정한 별칭은 가짜 모듈로 해석하는 resolve 훅을 만든다. */
export function createResolver(overrides = {}) {
  return function resolve(specifier, context, nextResolve) {
    if (specifier === "react") return nextResolve(import.meta.url, context);
    if (overrides[specifier]) return nextResolve(overrides[specifier], context);
    if (specifier.startsWith("@/")) {
      // 별칭이 디렉터리(배럴)를 가리키면 index.ts로 푼다.
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const file = existsSync(fileURLToPath(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`;
      return nextResolve(file, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  };
}

/** 가짜 타이머를 진행시키고, 그 사이 시작된 fetch 체인이 끝날 틈을 준다. */
export async function advance(t, ms) {
  if (ms > 0) t.mock.timers.tick(ms);
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 훅이 쓰는 브라우저 전역. window 타이머는 전역(mock 가능)으로 위임하고, document는 visibilityState를 바꿀 수 있다.
 * localStorage는 선택된 워크스페이스를 돌려주며 그 외 키는 메모리에 저장한다.
 */
export function browserEnv(t) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const storage = new Map([["fruition.workspace_id", "ws_test"]]);
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); }
    },
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args)
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });
  return { storage };
}

export function setPageVisible(visible) {
  globalThis.document.visibilityState = visible ? "visible" : "hidden";
  globalThis.document.dispatchEvent(new Event("visibilitychange"));
}
