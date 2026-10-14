import { useEffect, useRef } from "react";
import { createEscapeLayerStack, type EscapePriority } from "./escapeLayerStack";

const stack = createEscapeLayerStack();
let isListening = false;

/** document capture 단계에서 하나의 리스너로만 Escape를 받아 맨 위 레이어에 전달한다. */
function ensureListener() {
  if (isListening) return;
  isListening = true;
  document.addEventListener("keydown", (event) => stack.handleKeyDown(event), true);
}

/**
 * active인 동안 ESC 레이어 스택에 등록한다. 나중에 열린 레이어가 먼저 닫힌다.
 * onEscape는 ref로 최신 값을 읽으므로 인라인 함수여도 스택 순서가 바뀌지 않는다.
 * priority "fallback"은 다른 레이어가 하나도 없을 때만 실행된다(선택 해제 등).
 */
export function useEscapeLayer(active: boolean, onEscape: () => void, priority: EscapePriority = "layer"): void {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    ensureListener();
    return stack.push(handlerRef, priority);
  }, [active, priority]);
}
