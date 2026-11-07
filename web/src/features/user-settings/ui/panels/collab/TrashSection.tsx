"use client";

import { useTranslations } from "next-intl";
import styles from "../../SettingsModal.module.css";
import { TrashList } from "./TrashList";

/** 휴지통 메뉴에서 삭제된 문서 목록을 바로 확인하고 복구한다. */
export function TrashSection() {
  const t = useTranslations("settings.trash");
  return (
    <section className={styles.section} aria-label={t("sectionLabel")}>
      <TrashList />
    </section>
  );
}
