"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOwnedMcpRuns, type McpConnection } from "@/entities/user";
import { mcpApprovalRoute } from "@/features/mcp-approval/lib/mcpApproval";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import {
  clearMcpConnectionRuns,
  isMcpConnectionRunsAccessFailure,
  mcpConnectionRunsQueryKey
} from "../../lib/mcpConnectionRuns";
import styles from "../SettingsModal.module.css";
import panelStyles from "./McpConnectionRunsPanel.module.css";

export function McpConnectionRunsPanel({ userId, connection }: { userId: string; connection: McpConnection }) {
  const t = useTranslations("settings.mcpConnections.tasks");
  const shared = useTranslations("shared");
  const queryClient = useQueryClient();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const cursor = cursors[page] ?? null;
  const query = useQuery({
    queryKey: mcpConnectionRunsQueryKey(userId, connection.workspace_id, connection.grant_id, cursor),
    queryFn: () => fetchOwnedMcpRuns(connection.workspace_id, connection.grant_id, cursor),
    retry: false,
    enabled: !accessDenied
  });
  const accessFailure = query.error && isMcpConnectionRunsAccessFailure(query.error);

  useEffect(() => {
    if (!accessFailure) return;
    setAccessDenied(true);
    clearMcpConnectionRuns(queryClient, userId, connection.workspace_id, connection.grant_id);
  }, [accessFailure, connection.grant_id, connection.workspace_id, queryClient, userId]);

  useEffect(() => {
    const clear = () => {
      setAccessDenied(true);
      clearMcpConnectionRuns(queryClient);
    };
    window.addEventListener("fruition:auth-cleared", clear);
    return () => window.removeEventListener("fruition:auth-cleared", clear);
  }, [queryClient]);

  function nextPage() {
    if (!query.data?.next_cursor || query.isFetching) return;
    const next = query.data.next_cursor;
    setCursors((current) => [...current.slice(0, page + 1), next]);
    setPage((current) => current + 1);
  }

  return (
    <section className={panelStyles.panel} aria-label={t("title", { clientId: connection.client_id })}>
      <strong>{t("title", { clientId: connection.client_id })}</strong>
      <small className={styles["status-text"]}>{t("disclosure")}</small>
      <small className={styles["status-text"]}>{t("cancelWarning")}</small>
      {query.isPending && <small className={styles["status-text"]} role="status">{t("loading")}</small>}
      {query.isFetching && !query.isPending && <small className={styles["status-text"]} role="status">{t("loadingPage")}</small>}
      {(accessDenied || accessFailure) && <small className={styles["field-error"]} role="alert">{t("inaccessible")}</small>}
      {query.error && !accessFailure && (
        <div className={styles["tile-actions"]}>
          <small className={styles["field-error"]} role="alert">{getErrorMessage(query.error, t("loadFailed"), shared)}</small>
          <button type="button" className={styles.btn} disabled={query.isFetching} onClick={() => void query.refetch()}>{t("retry")}</button>
        </div>
      )}
      {!query.error && query.data?.items.length === 0 && <small className={styles["status-text"]}>{t("empty")}</small>}
      {!query.error && query.data && query.data.items.length > 0 && (
        <ul className={panelStyles.list} aria-label={t("listLabel")}>
          {query.data.items.map((run) => (
            <li className={styles.row} key={run.run_id}>
              <div className={styles["row-title"]}>
                <Link className={panelStyles.link} href={mcpApprovalRoute(connection.workspace_id, run.run_id)}>{run.run_id}</Link>
                <small>{t("status", { status: run.status })}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(page > 0 || query.data?.next_cursor) && !accessDenied && (
        <div className={styles["tile-actions"]}>
          <button type="button" className={styles.btn} disabled={page === 0 || query.isFetching}
            onClick={() => setPage((current) => Math.max(0, current - 1))}>{t("previous")}</button>
          <button type="button" className={styles.btn} disabled={!query.data?.next_cursor || query.isFetching}
            onClick={nextPage}>{t("next")}</button>
        </div>
      )}
    </section>
  );
}
