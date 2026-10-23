import styles from "./DocumentLoading.module.css";

export function DocumentLoading({
  children = "문서를 불러오는 중입니다.",
  detail,
  inline = false
}: { children?: string; detail?: string; inline?: boolean }) {
  return (
    <div className={`${styles.loading} ${inline ? styles.inline : ""}`} role="status" aria-live="polite">
      <span>{children}</span>
      <div className={styles.track} role="progressbar" aria-label={children}>
        <span className={styles.indicator} />
      </div>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
