import type { ReactNode } from "react";
import styles from "../SettingsModal.module.css";

/** 설정 패널 상단 제목 블록: 제목 한 줄과 설명. children은 설명 아래 보조 문구에 쓴다. */
export function PanelTitle({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className={styles.title}>
      <div className={styles["title-row"]}>
        <h2>{title}</h2>
      </div>
      <p>{description}</p>
      {children}
    </div>
  );
}
