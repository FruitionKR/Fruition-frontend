"use client";

import styles from "../SettingsModal.module.css";
import { TrashSection } from "./collab/TrashSection";

/** 휴지통: 삭제한 문서를 보관 기간(30일) 동안 복구한다. 편집이 겹치면 서버가 자동 병합하므로 충돌 화면은 없다. */
export function DocumentsPanel() {
  return (
    <div className={styles.detail}>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>휴지통</h2>
        </div>
        <p>삭제한 워크스페이스 문서를 확인하고 복구합니다.</p>
      </div>

      <TrashSection />
    </div>
  );
}
