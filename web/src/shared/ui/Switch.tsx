"use client";

import { cx } from "@/shared/lib/classNames";
import styles from "./Switch.module.css";

/**
 * role="switch" 토글 버튼. 기본 스타일은 Switch.module.css(설정 모달 스위치)이고,
 * 다른 치수·색을 쓰는 화면은 classNames로 자기 모듈의 클래스를 그대로 넘긴다.
 */
export function Switch({
  checked,
  label,
  disabled,
  onClick,
  offClassName,
  classNames
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  /** 꺼진 상태에 덧붙일 클래스 */
  offClassName?: string;
  /** 기본 클래스 대신 쓸 루트/켜짐/공 클래스 (지정하면 셋을 통째로 대체한다) */
  classNames?: { root: string; on?: string; ball?: string };
}) {
  const baseClass = classNames ? classNames.root : styles.switch;
  const onClass = classNames ? classNames.on : styles["is-on"];
  const ballClass = classNames ? classNames.ball : styles["switch-ball"];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx(baseClass, checked && onClass, !checked && offClassName)}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <span className={ballClass} />
    </button>
  );
}
