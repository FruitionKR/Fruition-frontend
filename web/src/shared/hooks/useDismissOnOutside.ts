import { useEffect, type RefObject } from "react";
import { useEscapeLayer } from "./useEscapeLayer";

/**
 * active일 때 ref 바깥 pointerdown 또는 Escape 키 입력 시 onDismiss를 호출한다. Escape는 맨 위 레이어일 때만 처리한다.
 * shouldIgnore가 true를 돌려주는 대상(메뉴를 토글하는 별도 트리거 등)의 pointerdown은 바깥으로 보지 않는다.
 */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
  shouldIgnore?: (target: Node) => boolean
): void {
  useEscapeLayer(active, onDismiss);

  useEffect(() => {
    if (!active) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (shouldIgnore?.(target)) return;
      if (ref.current && !ref.current.contains(target)) {
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active, onDismiss, ref, shouldIgnore]);
}
