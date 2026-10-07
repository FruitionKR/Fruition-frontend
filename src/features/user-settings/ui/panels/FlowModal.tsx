"use client";

import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackdropClick } from "@/shared/lib/useBackdropClick";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";
import { plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./AccountFlowModal.module.css";

/** 계정 흐름 모달 공통 셸: 제목·부제·닫기 버튼. */
export function FlowModal({
  title,
  stepLabel,
  subtitle,
  subtitleStyle,
  ariaLabel,
  canClose,
  onClose,
  onSubmit,
  children
}: {
  title: string;
  stepLabel?: string;
  subtitle: ReactNode;
  subtitleStyle?: React.CSSProperties;
  ariaLabel: string;
  /** false면 오버레이 클릭·Escape·닫기 버튼이 모두 막힌다(진행 중 등). */
  canClose: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  // 닫을 수 없는 동안에도 레이어는 유지해 Escape가 아래 설정 창으로 넘어가지 않게 한다.
  useEscapeKey(true, () => {
    if (canClose) onClose();
  });
  const backdropClick = useBackdropClick(canClose ? onClose : undefined);
  return createPortal(
    <div className={styles.overlay} {...backdropClick}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className={styles["title-block"]}>
          <div className={styles["title-row"]}>
            <div className={styles["title-stack"]}>
              {stepLabel && <p className={styles["step-label"]}>{stepLabel}</p>}
              <h2 className={styles.title}>{title}</h2>
            </div>
            <button type="button" className={styles.close} aria-label="닫기" disabled={!canClose} onClick={onClose}>
              <SvgIcon src={plusIcon} className={styles["close-icon"]} />
            </button>
          </div>
          <p className={styles.subtitle} style={subtitleStyle}>{subtitle}</p>
        </div>
        <div className={styles.body}>{children}</div>
      </form>
    </div>,
    document.body
  );
}
