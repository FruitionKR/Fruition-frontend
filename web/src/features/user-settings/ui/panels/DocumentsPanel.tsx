"use client";

import { useTranslations } from "next-intl";
import styles from "../SettingsModal.module.css";
import { TrashSection } from "./collab/TrashSection";

/** 휴지통: 삭제한 문서를 보관 기간(30일) 동안 복구한다. 편집이 겹치면 서버가 자동 병합하므로 충돌 화면은 없다. */
export function DocumentsPanel() {
  const t = useTranslations("settings.trash");
  return (
    <div className={styles.detail}>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>{t("title")}</h2>
        </div>
        <p>{t("description")}</p>
      </div>

      <TrashSection />
    </div>
  );
}
