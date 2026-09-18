"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import styles from "./HoverHint.module.css";

const HOVER_HINT_DELAY_MS = 2000;

/**
 * 감싼 버튼 위에 마우스를 2초 이상 올리면 동작 설명을 띄운다.
 * 포커스·클릭·마우스 이탈 시 즉시 닫는다. disabled 버튼 위에서도 뜨도록 래퍼가 이벤트를 받는다.
 */
export function HoverHint({
  text,
  placement = "top",
  align = "center",
  className,
  children
}: {
  text: string;
  placement?: "top" | "bottom";
  /** end는 말풍선을 버튼 오른쪽 끝에 맞춘다(사이드바 우측 가장자리 버튼용). */
  align?: "center" | "end";
  className?: string;
  children: ReactNode;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const hintId = useId();

  function clearTimer() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function hide() {
    clearTimer();
    setIsVisible(false);
  }

  function scheduleShow() {
    clearTimer();
    timerRef.current = window.setTimeout(() => setIsVisible(true), HOVER_HINT_DELAY_MS);
  }

  useEffect(() => clearTimer, []);

  return (
    <span
      className={cx(styles["hover-hint"], className)}
      onPointerEnter={scheduleShow}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      {children}
      {isVisible && (
        <span
          id={hintId}
          role="tooltip"
          className={cx(
            styles["hover-hint-bubble"],
            placement === "bottom" && styles["is-bottom"],
            align === "end" && styles["is-end"]
          )}
        >
          {text}
        </span>
      )}
    </span>
  );
}
