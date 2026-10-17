"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/shared/lib/classNames";
import { useBackdropClick } from "@/shared/hooks/useBackdropClick";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useModalFocus } from "@/shared/hooks/useModalFocus";
import styles from "./SideSheet.module.css";

/**
 * 오른쪽 시트 공통 셸 (Figma 1671:14199 스킬 만들기 · 1708:4061 스킬 상세).
 * 720px 패널 = 44px 제목 줄 + 스크롤 본문 + (선택) 하단 액션 줄.
 * 배경 클릭·Escape로 닫히고, 열려 있는 동안 Tab 포커스를 시트 안에 가두며, 닫히면 연 버튼으로 포커스를 돌려준다.
 */
export function SideSheet({
  title,
  onClose,
  footer,
  className,
  children
}: {
  /** 제목 줄 문구. 대화상자 이름(aria-labelledby)으로도 쓴다. */
  title: string;
  onClose: () => void;
  /** 하단 액션 줄 내용(오른쪽 정렬). 없으면 줄을 그리지 않는다. */
  footer?: ReactNode;
  /** 시트 패널(.sheet)에 덧붙일 소비자 측 클래스 */
  className?: string;
  children: ReactNode;
}) {
  useEscapeKey(true, onClose);
  const backdropClick = useBackdropClick(onClose);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(sheetRef);

  // 열리면 시트로 포커스를 옮겨 Tab이 시트 안에서 시작되게 한다.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  return createPortal(
    <div className={styles.overlay} {...backdropClick}>
      <div
        ref={sheetRef}
        className={cx(styles.sheet, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles["title-bar"]}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        </header>
        <div className={styles.body}>{children}</div>
        {footer != null && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
