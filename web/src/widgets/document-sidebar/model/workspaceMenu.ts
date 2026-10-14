import type { WorkspaceMember, WorkspaceRole } from "@/entities/workspace/api/members";

export type WorkspaceMenuRole = { role: WorkspaceRole | null; isLastOwner: boolean };

/** 워크스페이스 행 옵션 메뉴에 쓸 본인 역할과 마지막 OWNER 여부를 멤버 목록에서 구한다. */
export function getWorkspaceMenuRole(
  members: readonly Pick<WorkspaceMember, "user_id" | "role">[],
  userId: string
): WorkspaceMenuRole {
  const role = members.find((member) => member.user_id === userId)?.role ?? null;
  const ownerCount = members.filter((member) => member.role === "OWNER").length;
  return { role, isLastOwner: role === "OWNER" && ownerCount <= 1 };
}

/** 탈퇴는 역할 확인이 끝났고 마지막 OWNER가 아닐 때만 가능하다. */
export function canLeaveWorkspace({ role, isLastOwner }: WorkspaceMenuRole) {
  return role !== null && !isLastOwner;
}
