import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cx } from "@/shared/lib/classNames";
import type { GraphFilterKind } from "@/entities/wiki";
import styles from "./Graph.module.css";

export function GraphFilterChips({
  rawDocumentCount,
  sourceNodeCount,
  conceptNodeCount,
  visibleKinds,
  onToggleKind,
  children
}: {
  rawDocumentCount: number;
  sourceNodeCount: number;
  conceptNodeCount: number;
  visibleKinds: Record<GraphFilterKind, boolean>;
  onToggleKind: (kind: GraphFilterKind) => void;
  /** 칩 줄 끝에 붙는 그래프 동작(새로고침 등) */
  children?: ReactNode;
}) {
  const t = useTranslations("workspace.graph.filter");
  // 범례 칩(Figma legend): 종류별 점 + 이름 + 굵은 개수. 누르면 해당 종류를 그래프에서 켜고 끈다.
  const chip = (kind: GraphFilterKind, label: string, count: number) => (
    <button
      type="button"
      className={cx(styles["filter-chip"], !visibleKinds[kind] && styles["is-inactive"])}
      aria-pressed={visibleKinds[kind]}
      onClick={(event) => {
        event.stopPropagation();
        onToggleKind(kind);
      }}
    >
      <span className={cx(styles["chip-dot"], styles[kind])} aria-hidden="true" />
      <span className={styles["chip-text"]}>
        <span className={styles["chip-label"]}>{label}</span>
        <span className={styles["chip-count"]}>{count}</span>
      </span>
    </button>
  );

  return (
    <div className={styles["filter-chips"]}>
      {chip("raw", t("raw"), rawDocumentCount)}
      {chip("source", t("source"), sourceNodeCount)}
      {chip("concept", t("concept"), conceptNodeCount)}
      {children}
    </div>
  );
}
