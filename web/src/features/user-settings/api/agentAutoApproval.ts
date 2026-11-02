import { apiFetch, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import type { AgentAutoApprovalSettings } from "../lib/agentAutoApproval";

/** 사용자 단위 설정이다. 경로의 워크스페이스는 멤버 확인용이라 지금 고른 워크스페이스를 쓴다. */
function settingsPath(workspaceId: string) {
  return workspacePath(workspaceId, "agent", "auto-approval-settings");
}

export async function fetchAgentAutoApproval(workspaceId: string): Promise<AgentAutoApprovalSettings> {
  const response = await apiFetch(settingsPath(workspaceId), { cache: "no-store" });
  return parseJsonOrThrow<AgentAutoApprovalSettings>(response, "자동 승인 설정을 불러오지 못했습니다.");
}

export async function saveAgentAutoApproval(
  workspaceId: string,
  settings: AgentAutoApprovalSettings
): Promise<AgentAutoApprovalSettings> {
  const response = await apiFetch(settingsPath(workspaceId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_edit: settings.content_edit, organize: settings.organize })
  });
  return parseJsonOrThrow<AgentAutoApprovalSettings>(response, "자동 승인 설정을 저장하지 못했습니다.");
}
