"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import {
  fetchWorkspaceMcpConnections,
  fetchWorkspaceMcpPolicy,
  useSelectedWorkspace,
  useWorkspaceRole,
  WORKSPACE_MCP_SCOPES,
  type WorkspaceMcpConnection,
  type WorkspaceMcpPolicyUpdate,
  type WorkspaceMcpScope
} from "@/entities/workspace";
import type { WorkspaceMember } from "@/entities/workspace/api/members";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";
import { Switch } from "@/shared/ui/Switch";
import {
  canForceRevokeWorkspaceMcpConnection,
  clearWorkspaceMcpCache,
  forceRevokeWorkspaceMcpConnection,
  isWorkspaceMcpAccessFailure,
  saveWorkspaceMcpPolicy,
  workspaceMcpConnectionsQueryKey,
  workspaceMcpPolicyChanged,
  workspaceMcpPolicyNeedsConfirmation,
  workspaceMcpPolicyQueryKey
} from "../../lib/workspaceMcpManagement";
import styles from "../SettingsModal.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import panelStyles from "./WorkspaceMcpManagementSection.module.css";

const PAGE_SIZE = 20;

type Confirmation =
  | { kind: "policy"; update: WorkspaceMcpPolicyUpdate }
  | { kind: "revoke"; connection: WorkspaceMcpConnection };

/** 역할과 현재 사용자가 확정된 OWNER에게만 관리 컴포넌트를 연다. 서버 권한 검사가 최종 권위다. */
export function WorkspaceMcpManagementSection() {
  const workspace = useSelectedWorkspace();
  const role = useWorkspaceRole();
  const { data: me } = useMe();

  if (role.isLoading || !role.isOwner || !workspace || !me) return null;
  return <WorkspaceMcpManagement key={`${workspace.id}:${me.id}`} workspaceId={workspace.id} userId={me.id} />;
}

export function WorkspaceMcpManagement({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const t = useTranslations("settings.workspace.mcp");
  const shared = useTranslations("shared");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<WorkspaceMcpPolicyUpdate | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationInFlight = useRef(false);

  const policyKey = workspaceMcpPolicyQueryKey(workspaceId, userId);
  const policy = useQuery({
    queryKey: policyKey,
    queryFn: () => fetchWorkspaceMcpPolicy(workspaceId),
    enabled: !accessDenied,
    retry: false
  });
  const connections = useQuery({
    queryKey: workspaceMcpConnectionsQueryKey(workspaceId, userId, page),
    queryFn: () => fetchWorkspaceMcpConnections(workspaceId, page, PAGE_SIZE),
    enabled: !accessDenied,
    retry: false
  });

  useEffect(() => {
    if (!policy.data) return;
    setDraft({ enabled: policy.data.enabled, allowed_scopes: [...policy.data.allowed_scopes] });
  }, [policy.data]);

  const accessFailure = [policy.error, connections.error].find(isWorkspaceMcpAccessFailure);
  useEffect(() => {
    if (!accessFailure) return;
    setAccessDenied(true);
    setConfirmation(null);
    clearWorkspaceMcpCache(queryClient, workspaceId, userId);
  }, [accessFailure, queryClient, userId, workspaceId]);

  const savePolicy = useMutation({
    mutationFn: (update: WorkspaceMcpPolicyUpdate) => saveWorkspaceMcpPolicy(queryClient, workspaceId, userId, update),
    onSuccess: (saved) => {
      setDraft({ enabled: saved.enabled, allowed_scopes: [...saved.allowed_scopes] });
      setActionError(null);
      setMessage(t("policy.saved"));
    },
    onError: (error) => {
      if (isWorkspaceMcpAccessFailure(error)) {
        setAccessDenied(true);
        clearWorkspaceMcpCache(queryClient, workspaceId, userId);
      }
      setActionError(getErrorMessage(error, t("policy.saveFailed"), shared));
    }
  });
  const revokeConnection = useMutation({
    mutationFn: (connection: WorkspaceMcpConnection) =>
      forceRevokeWorkspaceMcpConnection(queryClient, workspaceId, userId, connection.grant_id),
    onSuccess: (result) => {
      setActionError(null);
      setMessage(t(result === "missing" ? "connections.alreadyUnavailable" : "connections.revoked"));
    },
    onError: (error) => {
      if (isWorkspaceMcpAccessFailure(error)) {
        setAccessDenied(true);
        clearWorkspaceMcpCache(queryClient, workspaceId, userId);
      }
      setActionError(getErrorMessage(error, t("connections.revokeFailed"), shared));
    }
  });
  const busy = savePolicy.isPending || revokeConnection.isPending;

  function startPolicyMutation(update: WorkspaceMcpPolicyUpdate) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    savePolicy.mutate(update, { onSettled: () => { mutationInFlight.current = false; } });
  }

  function startRevokeMutation(connection: WorkspaceMcpConnection) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    revokeConnection.mutate(connection, { onSettled: () => { mutationInFlight.current = false; } });
  }

  function toggleScope(scope: WorkspaceMcpScope) {
    if (!draft || busy) return;
    setMessage(null);
    setDraft({
      ...draft,
      allowed_scopes: draft.allowed_scopes.includes(scope)
        ? draft.allowed_scopes.filter((candidate) => candidate !== scope)
        : WORKSPACE_MCP_SCOPES.filter((candidate) => candidate === scope || draft.allowed_scopes.includes(candidate))
    });
  }

  function requestPolicySave() {
    if (!policy.data || !draft || busy || !workspaceMcpPolicyChanged(policy.data, draft)) return;
    const update = { enabled: draft.enabled, allowed_scopes: [...draft.allowed_scopes] };
    setMessage(null);
    setActionError(null);
    if (workspaceMcpPolicyNeedsConfirmation(policy.data, update)) {
      setConfirmation({ kind: "policy", update });
    } else {
      startPolicyMutation(update);
    }
  }

  function requestRevoke(connection: WorkspaceMcpConnection) {
    if (busy || !canForceRevokeWorkspaceMcpConnection(connection.status)) return;
    setMessage(null);
    setActionError(null);
    setConfirmation({ kind: "revoke", connection });
  }

  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  };
  const members = queryClient.getQueryData<WorkspaceMember[]>(["workspace-members", workspaceId]);
  const memberLabel = (userIdValue: string) => {
    const member = members?.find((candidate) => candidate.user_id === userIdValue);
    return member?.display_name || member?.email || userIdValue;
  };
  const scopeLabel = (scope: string) => WORKSPACE_MCP_SCOPES.includes(scope as WorkspaceMcpScope)
    ? t(`scopes.${scope as WorkspaceMcpScope}.label`)
    : scope;

  if (accessDenied || accessFailure) {
    return (
      <div className={styles.section}>
        <SettingsSectionHeader>{t("title")}</SettingsSectionHeader>
        <small className={styles["field-error"]} role="alert">
          {getErrorMessage(accessFailure, t("accessDenied"), shared)}
        </small>
      </div>
    );
  }

  const policyChanged = Boolean(policy.data && draft && workspaceMcpPolicyChanged(policy.data, draft));
  return (
    <>
      <div className={styles.section}>
        <SettingsSectionHeader>{t("title")}</SettingsSectionHeader>
        <div className={panelStyles.notice}>
          <small>{t("disclosure")}</small>
          <small>{t("identityWarning")}</small>
          <small>{t("lifecycleWarning")}</small>
          <small>{t("availabilityWarning")}</small>
        </div>

        {policy.isPending && <small className={styles["status-text"]} role="status">{t("policy.loading")}</small>}
        {policy.error && <small className={styles["field-error"]} role="alert">{getErrorMessage(policy.error, t("policy.loadFailed"), shared)}</small>}
        {policy.data && draft && (
          <div className={panelStyles.policy}>
            <div className={styles.row}>
              <div className={styles["row-title"]}>
                <strong>{t("policy.enabledLabel")}</strong>
                <small>{t(draft.enabled ? "policy.enabled" : "policy.disabled")}</small>
                <small>{policy.data.generation === null ? t("policy.noGeneration") : t("policy.generation", { generation: policy.data.generation })}</small>
                {policy.data.updated_at && <small>{t("policy.updatedAt", { date: formatDate(policy.data.updated_at) })}</small>}
              </div>
              <Switch
                checked={draft.enabled}
                disabled={busy}
                label={t("policy.enabledLabel")}
                onClick={() => { setMessage(null); setDraft({ ...draft, enabled: !draft.enabled }); }}
              />
            </div>

            <fieldset className={panelStyles.scopes} disabled={busy}>
              <legend>{t("policy.scopesLabel")}</legend>
              {WORKSPACE_MCP_SCOPES.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={draft.allowed_scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <span><strong>{t(`scopes.${scope}.label`)}</strong><small>{t(`scopes.${scope}.description`)}</small></span>
                </label>
              ))}
            </fieldset>
            <div className={styles["tile-actions"]}>
              <button type="button" className={styles.btn} disabled={!policyChanged || busy} onClick={requestPolicySave}>
                {savePolicy.isPending ? t("policy.saving") : t("policy.save")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>{t("connections.title")}</SettingsSectionHeader>
        <small className={styles["status-text"]}>{t("connections.description")}</small>
        {connections.isPending && <small className={styles["status-text"]} role="status">{t("connections.loading")}</small>}
        {connections.isFetching && !connections.isPending && <small className={styles["status-text"]} role="status">{t("connections.loadingPage")}</small>}
        {connections.error && <small className={styles["field-error"]} role="alert">{getErrorMessage(connections.error, t("connections.loadFailed"), shared)}</small>}
        {message && <small className={styles["status-text"]} role="status">{message}</small>}
        {actionError && <small className={styles["field-error"]} role="alert">{actionError}</small>}
        {connections.data?.connections.length === 0 && !connections.error && <small className={styles["status-text"]}>{t("connections.empty")}</small>}
        {connections.data && connections.data.connections.length > 0 && (
          <ul className={panelStyles.connections} aria-label={t("connections.title")}>
            {connections.data.connections.map((connection) => (
              <li className={styles.row} key={connection.grant_id}>
                <div className={styles["row-title"]}>
                  <strong className={panelStyles.value}>{connection.client_id}</strong>
                  <small className={panelStyles.value}>{t("connections.user", { user: memberLabel(connection.user_id) })}</small>
                  <small>{t("connections.scopes", { scopes: connection.scopes.map(scopeLabel).join(", ") || t("none") })}</small>
                  <small>{t("connections.status", { status: t(`connections.statusLabels.${connection.status}`) })}</small>
                  <small>{t("connections.createdAt", { date: formatDate(connection.created_at) })}</small>
                  {connection.revocation_reason && <small className={panelStyles.value}>{t("connections.reason", { reason: connection.revocation_reason })}</small>}
                  {connection.revoked_at && <small>{t("connections.revokedAt", { date: formatDate(connection.revoked_at) })}</small>}
                </div>
                {canForceRevokeWorkspaceMcpConnection(connection.status) && (
                  <button type="button" className={`${styles.btn} ${styles["btn-danger"]}`} disabled={busy}
                    onClick={() => requestRevoke(connection)}>
                    {revokeConnection.isPending && revokeConnection.variables?.grant_id === connection.grant_id
                      ? t("connections.processing") : t("connections.revoke")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {(page > 0 || connections.data?.has_next) && (
          <div className={styles["tile-actions"]}>
            <button type="button" className={styles.btn} disabled={page === 0 || connections.isFetching || busy}
              onClick={() => { setActionError(null); setPage((current) => Math.max(0, current - 1)); }}>{t("connections.previous")}</button>
            <button type="button" className={styles.btn} disabled={!connections.data?.has_next || connections.isFetching || busy}
              onClick={() => { setActionError(null); setPage((current) => current + 1); }}>{t("connections.next")}</button>
          </div>
        )}
      </div>

      {confirmation?.kind === "policy" && (
        <ConfirmModal
          titleId="workspace-mcp-policy-confirm-title"
          title={t("policy.confirmTitle")}
          description={t("policy.confirmDescription")}
          confirmLabel={t("policy.confirm")}
          tone="danger"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (busy) return;
            const update = confirmation.update;
            setConfirmation(null);
            startPolicyMutation(update);
          }}
        />
      )}
      {confirmation?.kind === "revoke" && (
        <ConfirmModal
          titleId="workspace-mcp-revoke-confirm-title"
          title={t("connections.confirmTitle")}
          description={t("connections.confirmDescription", {
            clientId: confirmation.connection.client_id,
            user: memberLabel(confirmation.connection.user_id)
          })}
          confirmLabel={t("connections.confirm")}
          tone="danger"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (busy) return;
            const connection = confirmation.connection;
            setConfirmation(null);
            startRevokeMutation(connection);
          }}
        />
      )}
    </>
  );
}
