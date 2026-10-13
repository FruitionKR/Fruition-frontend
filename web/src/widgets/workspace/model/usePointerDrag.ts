import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type DragSession<TBase> = { pointerId: number; startX: number; base: TBase };

/**
 * pointer capture 기반 수평 드래그의 공통 부분. 핸들의 pointerdown에서 start()로 시작 시점 기준값(base)을
 * 잡고, 상위 요소의 pointermove/up/cancel에서 resolve()로 자기 pointerId의 이벤트만 받아 이동량을 돌려준다.
 * 어떤 폭으로 해석할지는 사이드바·채팅 패널 훅이 각자 정한다.
 */
export function usePointerDrag<TBase>() {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragSession<TBase> | null>(null);

  function start(event: ReactPointerEvent<HTMLElement>, base: TBase) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, base };
    setIsDragging(true);
  }

  /** 이 드래그의 이벤트가 아니면 null. */
  function resolve(event: ReactPointerEvent<HTMLElement>): { base: TBase; deltaX: number } | null {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    return { base: drag.base, deltaX: event.clientX - drag.startX };
  }

  function end() {
    dragRef.current = null;
    setIsDragging(false);
  }

  return { isDragging, start, resolve, end };
}
