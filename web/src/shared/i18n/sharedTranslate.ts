import type koShared from "./messages/ko/shared.json";

/**
 * 공용 문구(`shared` 네임스페이스) 번역 함수의 타입. 컴포넌트의 `useTranslations("shared")`를 그대로 넘길 수 있다.
 * hook을 쓸 수 없는 순수 함수(shared/lib, entities 모델)는 이 함수를 마지막 인자로 받아 영어 화면에서도 맞는 문구를 낸다.
 * 넘기지 않으면 기존 한국어 문구를 쓴다. 테스트가 순수 모듈을 별칭 없이 import하므로 순수 모듈은 이 파일을 `import type`으로만 쓴다.
 */
type Leaves<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}` }[keyof T & string];
export type SharedMessageKey = Leaves<typeof koShared>;
export type SharedTranslationValues = Record<string, string | number | Date>;
export type SharedTranslate = (key: SharedMessageKey, values?: SharedTranslationValues) => string;

let browserTranslate: SharedTranslate | null = null;

/**
 * 브라우저에서 지금 화면 언어의 공용 번역 함수를 등록한다(SharedTranslatorBridge가 부른다).
 * 서버 렌더는 요청마다 언어가 달라 모듈 전역에 두지 않는다.
 */
export function registerSharedTranslate(translate: SharedTranslate | null): void {
  if (typeof window === "undefined") return;
  browserTranslate = translate;
}

/**
 * hook도 번역 함수 인자도 없는 코드(API 호출 함수의 기본 오류 문구 등)가 쓰는 공용 문구.
 * 등록된 번역 함수가 없으면(서버 렌더·테스트) 넘긴 한국어 문구를 그대로 쓴다.
 */
export function sharedText(key: SharedMessageKey, korean: string, values?: SharedTranslationValues): string {
  return browserTranslate ? browserTranslate(key, values) : korean;
}
