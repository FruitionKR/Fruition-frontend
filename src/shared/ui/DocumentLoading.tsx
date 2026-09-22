import styles from "./DocumentLoading.module.css";

export function DocumentLoading({ children = "문서를 불러오는 중입니다." }: { children?: string }) {
  return <div className={styles.loading} role="status">{children}</div>;
}
