import { useTranslations } from "next-intl";
import { cx } from "@/shared/lib/classNames";
import styles from "./Graph.module.css";

export function GraphEmptyState({
  loading,
  errorMessage
}: {
  loading: boolean;
  errorMessage: string | null;
}) {
  const t = useTranslations("workspace.graph");
  return (
    <div className={cx(styles["graph-empty"], errorMessage && styles["is-error"])}>
      {errorMessage ?? (loading ? t("loading") : t("empty"))}
    </div>
  );
}
