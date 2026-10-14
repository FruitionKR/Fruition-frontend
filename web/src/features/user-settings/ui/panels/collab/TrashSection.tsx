"use client";

import { useState } from "react";
import styles from "../../SettingsModal.module.css";
import { TrashModal } from "./TrashModal";

/** 문서 휴지통 요약 줄. 삭제 문서 목록은 "휴지통 열기"로 여는 TrashModal에서 본다. */
export function TrashSection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className={styles.section} aria-labelledby="document-trash-heading">
      <div className={styles["section-header"]}>
        <span id="document-trash-heading">휴지통</span>
        <span className={styles["section-line"]} />
      </div>
      <div className={styles.row}>
        <div className={styles["row-title"]}>
          <strong>휴지통</strong>
          <small>삭제된 문서를 30일 뒤 영구 삭제합니다. 그 전까지 복구할 수 있습니다.</small>
        </div>
        <button type="button" className={styles.btn} onClick={() => setIsOpen(true)}>
          휴지통 열기
        </button>
      </div>
      {isOpen && <TrashModal onClose={() => setIsOpen(false)} />}
    </section>
  );
}
