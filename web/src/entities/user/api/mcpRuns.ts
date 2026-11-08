import { apiFetch, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import { sharedText } from "@/shared/i18n/sharedTranslate";

export type OwnedMcpRun = {
  run_id: string;
  status: string;
};

export type OwnedMcpRunsResponse = {
  items: OwnedMcpRun[];
  next_cursor: string | null;
};

export async function fetchOwnedMcpRuns(
  workspaceId: string,
  grantId: string,
  cursor: string | null = null
): Promise<OwnedMcpRunsResponse> {
  const query = new URLSearchParams({ grant_id: grantId });
  if (cursor) query.set("cursor", cursor);
  query.set("limit", "20");
  const response = await apiFetch(`${workspacePath(workspaceId, "agent", "mcp-runs")}?${query}`, { cache: "no-store" });
  return parseJsonOrThrow<OwnedMcpRunsResponse>(
    response,
    sharedText("user.requestFailed.mcpRuns", "MCP 작업을 불러오지 못했습니다.")
  );
}
