import { apiFetch, parseJsonOrThrow, throwIfNotOk, workspacePath } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";

export const WORKSPACE_MCP_SCOPES = ["read", "write_propose", "wiki_write"] as const;

export type WorkspaceMcpScope = (typeof WORKSPACE_MCP_SCOPES)[number];
export type WorkspaceMcpConnectionStatus =
  | "ACTIVE"
  | "USER_DISCONNECTED"
  | "ADMIN_REVOKED"
  | "SECURITY_REVOKED"
  | "PURGED";

export type WorkspaceMcpPolicy = {
  workspace_id: string;
  enabled: boolean;
  allowed_scopes: WorkspaceMcpScope[];
  generation: number | null;
  updated_at: string | null;
};

export type WorkspaceMcpPolicyUpdate = Pick<WorkspaceMcpPolicy, "enabled" | "allowed_scopes">;

export type WorkspaceMcpConnection = {
  grant_id: string;
  workspace_id: string;
  user_id: string;
  client_id: string;
  scopes: string[];
  status: WorkspaceMcpConnectionStatus;
  revocation_reason: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type WorkspaceMcpConnectionsResponse = {
  connections: WorkspaceMcpConnection[];
  page: number;
  size: number;
  has_next: boolean;
};

export async function fetchWorkspaceMcpPolicy(workspaceId: string): Promise<WorkspaceMcpPolicy> {
  const response = await apiFetch(workspacePath(workspaceId, "mcp-policy"), { cache: "no-store" });
  return parseJsonOrThrow<WorkspaceMcpPolicy>(response, sharedText("workspace.requestFailed.mcpPolicyLoad", "MCP 정책을 불러오지 못했습니다."));
}

export async function updateWorkspaceMcpPolicy(
  workspaceId: string,
  update: WorkspaceMcpPolicyUpdate
): Promise<WorkspaceMcpPolicy> {
  const response = await apiFetch(workspacePath(workspaceId, "mcp-policy"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: update.enabled, allowed_scopes: update.allowed_scopes })
  });
  return parseJsonOrThrow<WorkspaceMcpPolicy>(response, sharedText("workspace.requestFailed.mcpPolicySave", "MCP 정책을 저장하지 못했습니다."));
}

export async function fetchWorkspaceMcpConnections(
  workspaceId: string,
  page = 0,
  size = 20
): Promise<WorkspaceMcpConnectionsResponse> {
  const query = new URLSearchParams({ page: String(page), size: String(size) });
  const response = await apiFetch(`${workspacePath(workspaceId, "mcp-connections")}?${query}`, { cache: "no-store" });
  return parseJsonOrThrow<WorkspaceMcpConnectionsResponse>(response, sharedText("workspace.requestFailed.mcpConnections", "워크스페이스 MCP 연결을 불러오지 못했습니다."));
}

export async function revokeWorkspaceMcpConnection(workspaceId: string, grantId: string): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId, "mcp-connections", grantId), { method: "DELETE" });
  await throwIfNotOk(response, sharedText("workspace.requestFailed.mcpRevoke", "워크스페이스 MCP 연결을 회수하지 못했습니다."));
}
