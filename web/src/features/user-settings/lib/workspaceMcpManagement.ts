import type { QueryClient } from "@tanstack/react-query";
import {
  revokeWorkspaceMcpConnection,
  updateWorkspaceMcpPolicy,
  type WorkspaceMcpConnectionStatus,
  type WorkspaceMcpConnectionsResponse,
  type WorkspaceMcpPolicy,
  type WorkspaceMcpPolicyUpdate
} from "@/entities/workspace/api/mcp";
import { ApiError, LoginRequiredError, SessionExpiredError } from "@/shared/lib/apiErrors";

export const workspaceMcpPolicyQueryKey = (workspaceId: string, userId: string) =>
  ["workspace-mcp-policy", workspaceId, userId] as const;

export const workspaceMcpConnectionsQueryKey = (workspaceId: string, userId: string, page: number) =>
  ["workspace-mcp-connections", workspaceId, userId, page] as const;

export const workspaceMcpConnectionsQueryPrefix = (workspaceId: string, userId: string) =>
  ["workspace-mcp-connections", workspaceId, userId] as const;

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((scope) => right.includes(scope));
}

export function workspaceMcpPolicyChanged(current: WorkspaceMcpPolicy, next: WorkspaceMcpPolicyUpdate): boolean {
  return current.enabled !== next.enabled || !sameScopes(current.allowed_scopes, next.allowed_scopes);
}

export function workspaceMcpPolicyNeedsConfirmation(current: WorkspaceMcpPolicy, next: WorkspaceMcpPolicyUpdate): boolean {
  return (current.enabled && !next.enabled) || !sameScopes(current.allowed_scopes, next.allowed_scopes);
}

export function canForceRevokeWorkspaceMcpConnection(status: WorkspaceMcpConnectionStatus): boolean {
  return status === "ACTIVE" || status === "USER_DISCONNECTED";
}

export function isWorkspaceMcpAccessFailure(error: unknown): boolean {
  return error instanceof LoginRequiredError || error instanceof SessionExpiredError ||
    (error instanceof ApiError && [401, 403, 404].includes(error.status));
}

export function clearWorkspaceMcpCache(queryClient: QueryClient, workspaceId: string, userId: string): void {
  queryClient.removeQueries({ queryKey: workspaceMcpPolicyQueryKey(workspaceId, userId), exact: true });
  queryClient.removeQueries({ queryKey: workspaceMcpConnectionsQueryPrefix(workspaceId, userId) });
}

export async function refreshWorkspaceMcpManagement(queryClient: QueryClient, workspaceId: string, userId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceMcpPolicyQueryKey(workspaceId, userId), exact: true, refetchType: "all" }),
    queryClient.invalidateQueries({ queryKey: workspaceMcpConnectionsQueryPrefix(workspaceId, userId), refetchType: "all" })
  ]);
}

export async function saveWorkspaceMcpPolicy(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string,
  update: WorkspaceMcpPolicyUpdate
): Promise<WorkspaceMcpPolicy> {
  const saved = await updateWorkspaceMcpPolicy(workspaceId, update);
  queryClient.setQueryData(workspaceMcpPolicyQueryKey(workspaceId, userId), saved);
  await refreshWorkspaceMcpManagement(queryClient, workspaceId, userId);
  return saved;
}

function removeCachedConnection(queryClient: QueryClient, workspaceId: string, userId: string, grantId: string): void {
  queryClient.setQueriesData<WorkspaceMcpConnectionsResponse>(
    { queryKey: workspaceMcpConnectionsQueryPrefix(workspaceId, userId) },
    (current) => current && { ...current, connections: current.connections.filter((connection) => connection.grant_id !== grantId) }
  );
}

export async function forceRevokeWorkspaceMcpConnection(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string,
  grantId: string
): Promise<"revoked" | "missing"> {
  let result: "revoked" | "missing" = "revoked";
  try {
    await revokeWorkspaceMcpConnection(workspaceId, grantId);
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    result = "missing";
  }
  removeCachedConnection(queryClient, workspaceId, userId, grantId);
  await queryClient.invalidateQueries({
    queryKey: workspaceMcpConnectionsQueryPrefix(workspaceId, userId),
    refetchType: "all"
  });
  return result;
}
