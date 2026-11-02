import { RefreshCw } from "lucide-react";
import { useUserPreferences } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { Tooltip } from "@/shared/ui/Tooltip";
import { useGraphRefresh } from "../model/useGraphRefresh";
import styles from "./Graph.module.css";

const REFRESH_LABEL = "그래프 새로고침";

/**
 * 범례 칩 옆 그래프 새로고침 버튼. 받는 동안 아이콘이 돌고(동작 줄이기면 멈춘 채 흐리게) 반복 클릭을 막는다.
 * 키보드 포커스를 잃지 않도록 disabled 대신 aria-disabled를 쓴다.
 */
export function GraphRefreshButton({ onRefresh }: { onRefresh: () => Promise<{ changed: boolean }> }) {
  const { reduceMotion } = useUserPreferences();
  const { status, refresh } = useGraphRefresh(onRefresh);
  const isLoading = status === "loading";

  return (
    <div className={styles["graph-refresh"]}>
      <span className={styles["graph-refresh-status"]} role="status">
        {status === "upToDate" ? "최신 상태예요" : ""}
      </span>
      <Tooltip content={REFRESH_LABEL} placement="bottom" describe={false}>
        <button
          type="button"
          className={cx(styles["graph-refresh-button"], isLoading && styles["is-loading"])}
          aria-label={REFRESH_LABEL}
          aria-busy={isLoading}
          aria-disabled={isLoading}
          onClick={(event) => {
            event.stopPropagation();
            void refresh();
          }}
        >
          <RefreshCw
            size={16}
            aria-hidden
            className={cx(styles["graph-refresh-icon"], isLoading && !reduceMotion && styles["is-spinning"])}
          />
        </button>
      </Tooltip>
    </div>
  );
}
