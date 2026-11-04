import { useEffect, useRef } from "react";
import { createOverlayEntry, getOverlayDepth, isOverlayDismissedBy } from "@/shared/lib/overlayHistory";

/**
 * 패널이 열린 동안 history에 표식을 하나 쌓아 뒤로 가기로 닫히게 한다(URL은 그대로).
 * 닫기 버튼으로 닫으면 표식을 되돌린다. 표식 위에서 다른 화면으로 이동하면 useWorkspaceNavigation이 표식을 대체한다.
 * 첫 렌더 직후 바로 닫히는 경우 표식이 쌓였다 빠지지 않도록 다음 틱에 쌓는다.
 */
export function useHistoryDismiss(isActive: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!isActive) return;
    let depth = 0;
    let isPopped = false;
    const handlePopState = (event: PopStateEvent) => {
      if (!isOverlayDismissedBy(event.state, depth)) return;
      isPopped = true;
      onDismissRef.current();
    };
    const timer = window.setTimeout(() => {
      depth = getOverlayDepth(window.history.state) + 1;
      window.history.pushState(createOverlayEntry(depth), "", window.location.href);
      window.addEventListener("popstate", handlePopState);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", handlePopState);
      if (depth > 0 && !isPopped && getOverlayDepth(window.history.state) === depth) window.history.back();
    };
  }, [isActive]);
}
