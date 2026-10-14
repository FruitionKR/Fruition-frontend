import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * 배경(오버레이) 자체를 누르고 뗐을 때만 onDismiss를 호출하는 이벤트 핸들러.
 *
 * mousedown과 mouseup이 서로 다른 요소에서 일어나면 브라우저는 두 요소의 공통 조상에서 click을 낸다.
 * 그래서 편집기·모달 안에서 드래그해 배경에서 놓아도 click target이 배경이 되어 닫혀 버린다.
 * pointerdown도 배경에서 시작했을 때만 닫는다. 반환값을 배경 요소에 그대로 펼쳐 쓴다.
 */
export function useBackdropClick<T extends Element = HTMLDivElement>(onDismiss: (() => void) | undefined) {
  const downOnBackdropRef = useRef(false);
  return {
    onPointerDown(event: PointerEvent<T>) {
      downOnBackdropRef.current = event.target === event.currentTarget;
    },
    onClick(event: MouseEvent<T>) {
      const startedOnBackdrop = downOnBackdropRef.current;
      downOnBackdropRef.current = false;
      if (startedOnBackdrop && event.target === event.currentTarget) onDismiss?.();
    }
  };
}
