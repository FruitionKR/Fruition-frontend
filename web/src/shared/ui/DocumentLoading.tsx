import { useTranslations } from "next-intl";
import styles from "./DocumentLoading.module.css";

export function DocumentLoading({
  children,
  detail,
  inline = false
}: { children?: string; detail?: string; inline?: boolean }) {
  const t = useTranslations("shared");
  const label = children ?? t("ui.documentLoading");
  return (
    <div className={`${styles.loading} ${inline ? styles.inline : ""}`} role="status" aria-live="polite">
      <span>{label}</span>
      <div className={styles.track} role="progressbar" aria-label={label}>
        <span className={styles.indicator} />
      </div>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
