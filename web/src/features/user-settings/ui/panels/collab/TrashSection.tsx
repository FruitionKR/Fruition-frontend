"use client";

import styles from "../../SettingsModal.module.css";
import { TrashList } from "./TrashList";

/** 휴지통 메뉴에서 삭제된 문서 목록을 바로 확인하고 복구한다. */
export function TrashSection() {
  return (
    <section className={styles.section} aria-label="삭제된 문서">
      <TrashList />
    </section>
  );
}
