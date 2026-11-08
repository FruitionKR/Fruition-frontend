import type { QueryClient } from "@tanstack/react-query";
import { ApiError, LoginRequiredError, SessionExpiredError } from "@/shared/lib/apiErrors";

export const MCP_CONNECTION_RUNS_QUERY_KEY = ["mcp-connection-runs"] as const;

export const mcpConnectionRunsQueryPrefix = (userId: string, workspaceId: string, grantId: string) =>
  [...MCP_CONNECTION_RUNS_QUERY_KEY, userId, workspaceId, grantId] as const;

export const mcpConnectionRunsQueryKey = (userId: string, workspaceId: string, grantId: string, cursor: string | null) =>
  [...mcpConnectionRunsQueryPrefix(userId, workspaceId, grantId), cursor] as const;

export function isMcpConnectionRunsAccessFailure(error: unknown): boolean {
  return error instanceof LoginRequiredError || error instanceof SessionExpiredError ||
    (error instanceof ApiError && [401, 403, 404].includes(error.status));
}

export function clearMcpConnectionRuns(
  queryClient: QueryClient,
  userId?: string,
  workspaceId?: string,
  grantId?: string
): void {
  const queryKey = userId && workspaceId && grantId
    ? mcpConnectionRunsQueryPrefix(userId, workspaceId, grantId)
    : MCP_CONNECTION_RUNS_QUERY_KEY;
  queryClient.removeQueries({ queryKey });
}
