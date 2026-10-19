"use client";

import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import { fetchMembers, type WorkspaceRole } from "@/entities/workspace/api/members";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

const MEMBERS_STALE_TIME_MS = 60_000;
const NO_PERMISSIONS: string[] = [];

/**
 * 선택된 워크스페이스에서 본인의 역할. 워크스페이스 목록 응답에 역할이 없어 멤버 목록으로 구한다.
 * 확인 전·실패·멤버 아님은 null이다(OWNER 전용 화면은 null이면 숨긴다).
 * permissions는 멤버 항목의 권한 목록(access #32)이며 확인 전·구 응답이면 빈 배열이다.
 */
export function useWorkspaceRole(): { role: WorkspaceRole | null; permissions: string[]; isOwner: boolean; isLoading: boolean } {
  const workspaceId = getSelectedWorkspaceId();
  const { data: me } = useMe();
  const members = useQuery({
    queryKey: ["workspace-members", workspaceId] as const,
    queryFn: () => fetchMembers(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: MEMBERS_STALE_TIME_MS
  });
  const self = me && members.data ? members.data.find((member) => member.user_id === me.id) : undefined;
  const role = self?.role ?? null;
  return { role, permissions: self?.permissions ?? NO_PERMISSIONS, isOwner: role === "OWNER", isLoading: members.isLoading || !me };
}
