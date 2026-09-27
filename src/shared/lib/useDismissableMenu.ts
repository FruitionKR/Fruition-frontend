import { useRef, type RefObject } from "react";
import { useDismissOnOutside } from "./useDismissOnOutside";

/**
 * 열려 있는 커스텀 메뉴를 Escape 키·바깥 pointerdown으로 닫는다.
 * 반환된 ref는 트리거 버튼과 메뉴를 함께 감싸는 래퍼에 붙인다.
 */
export function useDismissableMenu<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose: () => void
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useDismissOnOutside(ref, isOpen, onClose);
  return ref;
}
