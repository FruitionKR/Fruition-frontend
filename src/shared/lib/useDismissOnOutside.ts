import { useEffect, type RefObject } from "react";
import { useEscapeLayer } from "./useEscapeLayer";

/** active일 때 ref 바깥 pointerdown 또는 Escape 키 입력 시 onDismiss를 호출한다. Escape는 맨 위 레이어일 때만 처리한다. */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void
): void {
  useEscapeLayer(active, onDismiss);

  useEffect(() => {
    if (!active) return;

    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active, onDismiss, ref]);
}
