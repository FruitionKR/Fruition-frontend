import { useEffect } from "react";
import { computeKeyboardInset } from "@/shared/lib/keyboardInset";

/**
 * 가상 키보드가 가리는 높이를 html의 --keyboard-inset과 is-keyboard-open 클래스로 알린다.
 * 값은 휴대폰 레이아웃 @media 안에서만 쓰여 넓은 화면의 모습에는 영향이 없다.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const sync = () => {
      const inset = computeKeyboardInset({
        layoutHeight: window.innerHeight,
        visualHeight: viewport.height,
        visualOffsetTop: viewport.offsetTop,
        scale: viewport.scale
      });
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      root.classList.toggle("is-keyboard-open", inset > 0);
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      root.style.removeProperty("--keyboard-inset");
      root.classList.remove("is-keyboard-open");
    };
  }, []);
}
