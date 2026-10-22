import type { ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import styles from "./SettingsModal.module.css";

/** 설정 패널 섹션 머리말: 섹션 이름과 오른쪽으로 이어지는 구분선. id는 radiogroup 등의 aria-labelledby 대상이다. */
export function SettingsSectionHeader({ id, children, prominent = false, action }: { id?: string; children: ReactNode; prominent?: boolean; action?: ReactNode }) {
  return (
    <div className={cx(styles["section-header"], prominent && styles["is-prominent"])}>
      <span id={id}>{children}</span>
      <span className={styles["section-line"]} />
      {action}
    </div>
  );
}
