"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/shared/lib/classNames";
import {
  computeTooltipPosition,
  getTooltipOpenDelay,
  type TooltipPlacement,
  type TooltipPosition
} from "./Tooltip.logic";
import styles from "./Tooltip.module.css";

// 화면 전체에서 툴팁은 하나만 띄운다. 떠 있는 툴팁의 닫기 함수와 마지막 닫힘 시각으로 warm-up을 판단한다.
let activeTooltipClose: (() => void) | null = null;
let lastTooltipClosedAt: number | null = null;

/**
 * 빠르게 뜨는 설명 말풍선. 레일처럼 overflow가 걸린 곳에서도 잘리지 않게 body에 portal로 띄운다.
 * hover 150ms(다른 툴팁에서 옮겨 오면 즉시)·키보드 포커스에 열리고, 이탈·클릭·Esc·스크롤에 닫힌다.
 * disabled 버튼 위에서도 뜨도록 래퍼가 이벤트를 받는다. 트리거에는 title을 두지 않는다(이중 툴팁 방지).
 */
export function Tooltip({
  content,
  hint,
  placement = "right",
  disabled = false,
  describe = true,
  children
}: {
  content: ReactNode;
  /** 아래 보조줄(단축키 <kbd>, 비활성 사유 등) */
  hint?: ReactNode;
  placement?: TooltipPlacement;
  /** 팝오버가 열려 있을 때처럼 툴팁을 숨겨야 하는 동안 true */
  disabled?: boolean;
  /** aria-label과 같은 문구라 읽어 줄 필요가 없으면 false로 aria-describedby를 생략한다. */
  describe?: boolean;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const isOpenRef = useRef(false);
  const tooltipId = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    if (!isOpenRef.current) return;
    isOpenRef.current = false;
    if (activeTooltipClose === hide) activeTooltipClose = null;
    lastTooltipClosedAt = Date.now();
    setIsOpen(false);
    setPosition(null);
  }, [clearTimer]);

  const show = useCallback(() => {
    clearTimer();
    if (isOpenRef.current) return;
    if (activeTooltipClose && activeTooltipClose !== hide) activeTooltipClose();
    activeTooltipClose = hide;
    isOpenRef.current = true;
    setIsOpen(true);
  }, [clearTimer, hide]);

  function scheduleShow(event: PointerEvent<HTMLSpanElement>) {
    // 터치는 hover가 없으므로 탭할 때 말풍선을 띄우지 않는다.
    if (disabled || event.pointerType === "touch") return;
    clearTimer();
    const delay = getTooltipOpenDelay({
      now: Date.now(),
      lastClosedAt: lastTooltipClosedAt,
      isAnyOpen: activeTooltipClose !== null
    });
    if (delay === 0) show();
    else timerRef.current = window.setTimeout(show, delay);
  }

  function showOnKeyboardFocus(event: FocusEvent<HTMLSpanElement>) {
    if (disabled || !(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
    show();
  }

  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  // 언마운트 시 타이머와 전역 상태를 정리한다.
  useEffect(() => hide, [hide]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    document.addEventListener("keydown", handleKeyDown);
    // 스크롤·리사이즈로 트리거가 움직이면 위치가 어긋나므로 닫는다.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [isOpen, hide]);

  // 그리기 전에 말풍선 크기를 재서 위치를 정한다(첫 렌더는 visibility: hidden).
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current || !bubbleRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const bubble = bubbleRef.current;
    setPosition(
      computeTooltipPosition({
        anchor,
        size: { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement
      })
    );
  }, [isOpen, content, hint, placement]);

  const isDescribing = isOpen && describe;
  const bubbleStyle = position
    ? ({ top: position.top, left: position.left, "--tooltip-arrow-offset": `${position.arrowOffset}px` } as CSSProperties)
    : undefined;

  return (
    <span
      ref={anchorRef}
      className={styles["tooltip-anchor"]}
      onPointerEnter={scheduleShow}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={showOnKeyboardFocus}
      onBlur={hide}
    >
      {cloneElement(children, {
        "aria-describedby": isDescribing ? tooltipId : children.props["aria-describedby"]
      })}
      {isOpen &&
        createPortal(
          <div
            ref={bubbleRef}
            id={tooltipId}
            role="tooltip"
            className={cx(styles.tooltip, styles[`is-${position?.placement ?? placement}`], !position && styles["is-measuring"])}
            style={bubbleStyle}
          >
            <span className={styles["tooltip-label"]}>{content}</span>
            {hint && <span className={styles["tooltip-hint"]}>{hint}</span>}
            <span className={styles["tooltip-arrow"]} aria-hidden />
          </div>,
          document.body
        )}
    </span>
  );
}
