"use client";

import { useTranslations } from "next-intl";
import { describeStorageUsage, useStorageUsage } from "@/entities/workspace";
import { cx } from "@/shared/lib/classNames";
import styles from "./StorageUsageMeter.module.css";

/**
 * 문서 패널 맨 아래 내 저장 공간 사용량. 한도가 있으면 막대를, 90% 이상이면 경고 색을 쓴다.
 * 불러오는 중이거나 실패하면 아무것도 그리지 않는다(업로드는 서버가 판단한다).
 */
export function StorageUsageMeter() {
  const t = useTranslations("documents.sidebar");
  const { data, isError } = useStorageUsage();
  if (isError || !data) return null;
  const view = describeStorageUsage(data);

  return (
    <div className={cx(styles.meter, view.isWarning && styles["is-warning"])}>
      <p id="storage-usage-label" className={styles.label}>{view.label}</p>
      {view.percent !== null && (
        <div
          role="progressbar"
          aria-labelledby="storage-usage-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          aria-valuetext={t("storageUsed", { percent: view.percent })}
          className={styles.track}
        >
          <span className={styles.fill} style={{ transform: `scaleX(${view.percent / 100})` }} />
        </div>
      )}
    </div>
  );
}
