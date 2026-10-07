import { useEscapeLayer } from "./useEscapeLayer";

/** active일 때 Escape 키 입력 시 onEscape를 호출한다. 열린 레이어 중 맨 위 하나만 닫힌다(useEscapeLayer). */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEscapeLayer(active, onEscape);
}
