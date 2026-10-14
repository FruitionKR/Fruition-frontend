"use client";

import { ChevronRight } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/shared/lib/classNames";
import { useBackdropClick } from "@/shared/hooks/useBackdropClick";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { plusIcon, chevronLeftSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./AccountFlowModal.module.css";

/** 이메일 인증번호·인증 앱 코드 자릿수. */
export const CODE_LENGTH = 6;

/** 계정 흐름 모달 공통 셸: 제목·부제·닫기 버튼. */
export function AccountFlowModal({
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

/** 입력 칸 아래 오류 문구. 없으면 그리지 않는다. */
export function FlowError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className={styles.error} role="alert">{error}</p>;
}

/** 6자리 숫자 코드 입력. 라벨·안내는 호출부가 감싼다. */
export function VerificationCodeInput({
  id,
  value,
  disabled,
  onChange
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={CODE_LENGTH}
      placeholder="XXXXXX"
      autoFocus
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** 푸터의 '이전' 버튼. */
export function FlowBackButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles["btn-back"]} disabled={disabled} onClick={onClick}>
      <SvgIcon src={chevronLeftSmallIcon} className={styles["back-icon"]} /> 이전
    </button>
  );
}

/** 푸터의 제출 버튼. showChevron이 false면(처리 중·마지막 단계) 화살표를 숨긴다. */
export function FlowNextButton({
  disabled,
  showChevron,
  className,
  autoFocus,
  children
}: {
  disabled: boolean;
  showChevron: boolean;
  className?: string;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="submit" className={cx(styles["btn-next"], className)} disabled={disabled} autoFocus={autoFocus}>
      {children}
      {showChevron && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
    </button>
  );
}
