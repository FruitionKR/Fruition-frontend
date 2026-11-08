import { apiFetch, parseJsonOrThrow, throwIfNotOk } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";

export type McpConnectionStatus =
  | "ACTIVE"
  | "USER_DISCONNECTED"
  | "ADMIN_REVOKED"
  | "SECURITY_REVOKED"
  | "PURGED";

export type McpConnection = {
  grant_id: string;
  workspace_id: string;
  client_id: string;
  scopes: string[];
  status: McpConnectionStatus;
  revocation_reason: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type McpConnectionsResponse = {
  connections: McpConnection[];
  page: number;
  size: number;
  has_next: boolean;
};

export const MCP_CONNECTIONS_QUERY_KEY = ["mcp-connections"] as const;

export async function fetchMcpConnections(page = 0, size = 20): Promise<McpConnectionsResponse> {
  const response = await apiFetch(`/api/mcp/connections?page=${page}&size=${size}`, { cache: "no-store" });
  return parseJsonOrThrow<McpConnectionsResponse>(response, sharedText("user.requestFailed.mcpConnections", "MCP 연결을 불러오지 못했습니다."));
}

export async function disconnectMcpConnection(grantId: string): Promise<void> {
  const response = await apiFetch(`/api/mcp/connections/${encodeURIComponent(grantId)}`, { method: "DELETE" });
  await throwIfNotOk(response, sharedText("user.requestFailed.mcpDisconnect", "MCP 연결을 해제하지 못했습니다."));
}
