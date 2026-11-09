"use client";

import { useConfirmation } from "@/shared/ui/modal/useConfirmation";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disconnectMcpConnection,
  fetchMcpConnections,
  MCP_CONNECTIONS_QUERY_KEY,
  type McpConnection,
  type McpConnectionsResponse,
  useMe
} from "@/entities/user";
import { clearMcpConnectionRuns } from "../../lib/mcpConnectionRuns";
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import panelStyles from "./ProfilePanel.module.css";
import { McpConnectionRunsPanel } from "./McpConnectionRunsPanel";

const PAGE_SIZE = 20;

function connectionQueryKey(userId: string, page: number) {
  return [...MCP_CONNECTIONS_QUERY_KEY, userId, page] as const;
}

function connectionQueryPrefix(userId: string) {
  return [...MCP_CONNECTIONS_QUERY_KEY, userId] as const;
}

export function McpConnectionsSection() {
  const { confirm, confirmationDialog } = useConfirmation();
  const t = useTranslations("settings.mcpConnections");
  const shared = useTranslations("shared");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const me = useMe();
  const userId = me.data?.id ?? "";
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{ userId: string; connection: McpConnection } | null>(null);
  const [pendingGrantId, setPendingGrantId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { data, error: connectionLoadError, isFetching, isPending, refetch } = useQuery({
    queryKey: connectionQueryKey(userId, page),
    queryFn: () => fetchMcpConnections(page, PAGE_SIZE),
    retry: false,
    enabled: Boolean(userId),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === userId ? previous : undefined
  });
  const loadError = me.error ?? connectionLoadError;

  useEffect(() => {
    const clear = () => {
      setSelected(null);
      queryClient.removeQueries({ queryKey: MCP_CONNECTIONS_QUERY_KEY });
      clearMcpConnectionRuns(queryClient);
    };
    window.addEventListener("fruition:auth-cleared", clear);
    return () => window.removeEventListener("fruition:auth-cleared", clear);
  }, [queryClient]);

  async function refreshFirstPage(): Promise<void> {
    await queryClient.fetchQuery({
      queryKey: connectionQueryKey(userId, 0),
      queryFn: () => fetchMcpConnections(0, PAGE_SIZE),
      staleTime: 0
    });
  }

  async function removeCachedConnection(grantId: string): Promise<void> {
    const queryKey = connectionQueryPrefix(userId);
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueriesData<McpConnectionsResponse>({ queryKey }, (current) => current && {
      ...current,
      connections: current.connections.filter((connection) => connection.grant_id !== grantId)
    });
  }

  async function disconnect(connection: McpConnection) {
    if (pendingGrantId || !await confirm({ title: t("disconnectConfirmation", { clientId: connection.client_id }), confirmLabel: t("disconnect") })) return;
    setPendingGrantId(connection.grant_id);
    setActionError(null);
    setMessage(null);
    try {
      await disconnectMcpConnection(connection.grant_id);
      await removeCachedConnection(connection.grant_id);
      setPage(0);
      try {
        await refreshFirstPage();
        setMessage(t("disconnected"));
      } catch (refreshError: unknown) {
        setActionError(t("refreshAfterDisconnectFailed", { error: getErrorMessage(refreshError, t("tryAgain"), shared) }));
      }
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.status === 404) {
        try {
          await removeCachedConnection(connection.grant_id);
          await refetch({ throwOnError: true });
          setActionError(t("alreadyUnavailable"));
        } catch (refreshError: unknown) {
          setActionError(t("unavailableRefreshFailed", { error: getErrorMessage(refreshError, t("tryAgain"), shared) }));
        }
      } else {
        setActionError(getErrorMessage(cause, t("disconnectFailed"), shared));
      }
    } finally {
      setPendingGrantId(null);
    }
  }

  const connections = data?.connections;
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className={styles.section}>
      {confirmationDialog}
      <SettingsSectionHeader>{t("title")}</SettingsSectionHeader>
      <small className={styles["status-text"]}>
        {t("disclosure")}
      </small>
      {(me.isPending || (userId && isPending)) && <small className={styles["status-text"]} role="status">{t("loading")}</small>}
      {isFetching && !isPending && <small className={styles["status-text"]} role="status">{t("loadingPage")}</small>}
      {loadError && <small className={styles["field-error"]} role="alert">{getErrorMessage(loadError, t("loadFailed"), shared)}</small>}
      {message && <small className={styles["status-text"]} role="status">{message}</small>}
      {actionError && <small className={styles["field-error"]} role="alert">{actionError}</small>}
      {connections && connections.length > 0 && (
        <ul className={panelStyles["connection-list"]} aria-label={t("title")}>
          {connections.map((connection) => (
            <li className={styles.row} key={connection.grant_id}>
              <div className={styles["row-title"]}>
                <strong className={panelStyles["connection-value"]}>{connection.client_id}</strong>
                <small className={panelStyles["connection-value"]}>{t("workspace", { workspaceId: connection.workspace_id })}</small>
                <small>{t("scopes", { scopes: connection.scopes.join(", ") || t("none") })}</small>
                <small>{t("status", { status: t(`statusLabels.${connection.status}`) })}</small>
                <small>{t("connectedAt", { date: formatDate(connection.created_at) })}</small>
                {connection.revocation_reason && <small>{t("revocationReason", { reason: connection.revocation_reason })}</small>}
                {connection.revoked_at && <small>{t("revokedAt", { date: formatDate(connection.revoked_at) })}</small>}
              </div>
              <div className={styles["tile-actions"]}>
                <button type="button" className={styles.btn} disabled={pendingGrantId !== null}
                  onClick={() => setSelected({ userId, connection })}>{t("viewTasks")}</button>
                {connection.status === "ACTIVE" && (
                  <button type="button" className={styles.btn} disabled={pendingGrantId !== null}
                    onClick={() => void disconnect(connection)}>
                    {pendingGrantId === connection.grant_id ? t("processing") : t("disconnect")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {connections && connections.length === 0 && !loadError && (
        <small className={styles["status-text"]}>{t("empty")}</small>
      )}
      {(page > 0 || data?.has_next) && (
        <div className={styles["tile-actions"]}>
          <button type="button" className={styles.btn} disabled={page === 0 || isFetching || pendingGrantId !== null}
            onClick={() => setPage((current) => Math.max(0, current - 1))}>{t("previous")}</button>
          <button type="button" className={styles.btn} disabled={!data?.has_next || isFetching || pendingGrantId !== null}
            onClick={() => setPage((current) => current + 1)}>{t("next")}</button>
        </div>
      )}
      {selected?.userId === userId && (
        <McpConnectionRunsPanel
          key={`${selected.userId}:${selected.connection.workspace_id}:${selected.connection.grant_id}`}
          userId={selected.userId}
          connection={selected.connection}
        />
      )}
    </div>
  );
}
