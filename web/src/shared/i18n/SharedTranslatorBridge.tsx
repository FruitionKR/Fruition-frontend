"use client";

import { useTranslations } from "next-intl";
import { registerSharedTranslate } from "./sharedTranslate";

/**
 * 지금 언어의 공용 번역 함수를 브라우저 모듈에 등록한다. hook을 못 쓰는 API 호출 함수의 기본 오류 문구가 이 함수로 번역된다.
 * 언어를 바꾸면 router.refresh()로 다시 렌더되며 새 언어의 함수로 바뀐다. 화면에는 아무것도 그리지 않는다.
 */
export function SharedTranslatorBridge() {
  const t = useTranslations("shared");
  // 자식 컴포넌트의 첫 effect보다 먼저 등록되도록 렌더 중에 바꾼다(브라우저에서만 저장된다).
  registerSharedTranslate(t);
  return null;
}
