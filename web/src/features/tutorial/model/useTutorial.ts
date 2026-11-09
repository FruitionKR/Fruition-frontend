"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearTutorialPosition,
  isFirstStep,
  isLastStep,
  nextPosition,
  prevPosition,
  readTutorialPosition,
  sectionStart,
  tutorialProgress,
  writeTutorialPosition,
  type TutorialPosition,
  type TutorialSectionShape,
  type TutorialStorage
} from "./tutorialNavigation";

/** 레일 `?` 버튼이 여는 튜토리얼 모달의 열림 상태. 처음 방문 때 자동으로 열지 않는다. */
export function useTutorialDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, open, close };
}

/** 브라우저 localStorage. 접근 자체가 던지는 환경(차단된 사이트 데이터 등)이면 null. */
function browserStorage(): TutorialStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 모달이 열려 있는 동안의 단계 위치. 모달을 열 때(마운트) 마지막으로 본 자리를 읽고, 옮길 때마다 저장한다.
 * finish는 저장을 지워 다음에 열면 처음부터 보이게 한다.
 */
export function useTutorialProgress<S extends TutorialSectionShape>(sections: readonly S[], initialSectionIndex?: number) {
  // 특정 섹션을 열어 달라는 진입점(채팅 ⋯ 메뉴의 외부 AI 연결 등)은 저장된 자리 대신 그 섹션 처음에서 시작한다.
  const [position, setPosition] = useState<TutorialPosition>(() => initialSectionIndex !== undefined && initialSectionIndex >= 0
    ? sectionStart(sections, initialSectionIndex)
    : readTutorialPosition(browserStorage(), sections));

  useEffect(() => {
    writeTutorialPosition(browserStorage(), sections, position);
  }, [sections, position]);

  const section = sections[position.sectionIndex];
  return {
    position,
    section,
    step: section?.steps[position.stepIndex] as S["steps"][number] | undefined,
    progress: tutorialProgress(sections, position),
    isFirst: isFirstStep(sections, position),
    isLast: isLastStep(sections, position),
    goNext: () => setPosition((current) => nextPosition(sections, current)),
    goPrev: () => setPosition((current) => prevPosition(sections, current)),
    goToSection: (sectionIndex: number) => setPosition(sectionStart(sections, sectionIndex)),
    goToStep: (stepIndex: number) => setPosition((current) => ({ sectionIndex: current.sectionIndex, stepIndex })),
    finish: () => clearTutorialPosition(browserStorage())
  };
}
