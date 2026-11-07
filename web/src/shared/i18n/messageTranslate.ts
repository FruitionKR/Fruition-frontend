import type { SharedTranslationValues } from "./sharedTranslate";

/** 메시지 객체 T의 잎 키("a.b.c"). */
export type MessageLeaves<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageLeaves<T[K]>}` }[keyof T & string];

/**
 * 네임스페이스(또는 그 하위 묶음) 번역 함수의 타입. T는 ko 메시지 JSON의 해당 묶음이다(`typeof koWiki.export` 등).
 * 컴포넌트의 `useTranslations("wiki.export")`를 그대로 넘길 수 있다. `shared`가 아닌 네임스페이스 문구를 쓰는 순수 함수가
 * `SharedTranslate`처럼 마지막 인자로 받는다. 순수 모듈은 이 파일과 메시지 JSON을 `import type`으로만 쓴다.
 */
export type MessageTranslate<T> = (key: MessageLeaves<T>, values?: SharedTranslationValues) => string;
