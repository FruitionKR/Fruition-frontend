"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

/**
 * Tab으로 다음에 갈 위치. 모달 끝에서 처음으로(Shift+Tab이면 처음에서 끝으로) 돌린다.
 * 돌릴 필요가 없으면 null이라 브라우저 기본 이동에 맡긴다.
 */
export function wrapFocusIndex(currentIndex: number, count: number, isBackward: boolean): number | null {
  if (count === 0) return null;
  if (isBackward) return currentIndex <= 0 ? count - 1 : null;
  return currentIndex === -1 || currentIndex >= count - 1 ? 0 : null;
}

/**
 * aria-modal 모달의 키보드 포커스를 모달 안에 가두고, 닫히면 연 버튼으로 돌려준다.
 * 모달 뒤 레일·사이드바로 Tab이 빠지거나 닫은 뒤 포커스가 body로 떨어지지 않게 한다.
 */
export function useModalFocus(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function handleKeyDown(event: KeyboardEvent) {
      const container = containerRef.current;
      if (event.key !== "Tab" || !container) return;
      // 위에 겹쳐 연 다른 모달(시트 위 문서 선택 모달 등)에 포커스가 있으면 그 모달이 Tab을 관리한다.
      const activeModal = document.activeElement?.closest("[aria-modal='true']");
      if (activeModal && !container.contains(activeModal) && !activeModal.contains(container)) return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);
      const nextIndex = wrapFocusIndex(currentIndex, focusables.length, event.shiftKey);
      if (nextIndex === null) return;
      event.preventDefault();
      focusables[nextIndex].focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // 연 버튼이 아직 화면에 있을 때만 돌려준다.
      if (opener?.isConnected) opener.focus();
    };
  }, [containerRef]);
}
