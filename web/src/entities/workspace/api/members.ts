import { apiFetch, parseJsonOrThrow, throwIfNotOk, workspacePath } from "@/shared/api/client";
import type { WorkspacePermission } from "@/shared/lib/workspacePermissions";

export type WorkspaceRole = "OWNER" | "MEMBER";
export type WorkspaceMember = {
  user_id: string;
  email: string;
  display_name: string | null;
  /** 프로필 사진 조회 경로. 사진이 없으면 null. */
  avatar_url?: string | null;
  provider: string;
  role: WorkspaceRole;
  /** 부여된 권한 항목(정렬됨). OWNER는 항상 다섯 개 전부다(access #32). */
  permissions: WorkspacePermission[];
  joined_at: string;
};

export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const response = await apiFetch(workspacePath(workspaceId, "members"), { cache: "no-store" });
  const data = await parseJsonOrThrow<{ members: WorkspaceMember[] }>(response, "멤버 목록을 불러오지 못했습니다.");
  return data.members;
}

export async function changeMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
  const response = await apiFetch(workspacePath(workspaceId, "members", userId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role })
  });
  return parseJsonOrThrow<WorkspaceMember>(response, "멤버 권한을 변경하지 못했습니다.");
}

/** MEMBER의 권한 항목 전체를 교체한다. OWNER만 호출할 수 있고, 대상이 OWNER면 400 OWNER_PERMISSIONS_FIXED다. */
export async function updateMemberPermissions(workspaceId: string, userId: string, permissions: readonly WorkspacePermission[]): Promise<WorkspaceMember> {
  const response = await apiFetch(workspacePath(workspaceId, "members", userId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions })
  });
  return parseJsonOrThrow<WorkspaceMember>(response, "멤버 권한 항목을 변경하지 못했습니다.");
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId, "members", userId), { method: "DELETE" });
  await throwIfNotOk(response, "멤버를 제거하지 못했습니다.");
}

export async function inviteMember(workspaceId: string, email: string, role: WorkspaceRole): Promise<void> {
  const response = await apiFetch(workspacePath(workspaceId, "invitations"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role })
  });
  await throwIfNotOk(response, "초대 메일을 보내지 못했습니다.");
}
