import { useEffect, useRef } from "react";
import { createOverlayHistory } from "@/shared/lib/overlayHistory";

// 패널들이 진행 중인 back()을 함께 알아야 하므로 하나를 나눠 쓴다.
let overlayHistory: ReturnType<typeof createOverlayHistory> | null = null;

/**
 * 패널이 열린 동안 history에 표식을 하나 쌓아 뒤로 가기로 닫히게 한다(URL은 그대로).
 * 닫기 버튼으로 닫으면 표식을 되돌린다. 표식 위에서 다른 화면으로 이동하면 useWorkspaceNavigation이 표식을 대체한다.
 */
export function useHistoryDismiss(isActive: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!isActive) return;
    overlayHistory ??= createOverlayHistory(window);
    return overlayHistory.open(() => onDismissRef.current());
  }, [isActive]);
}
