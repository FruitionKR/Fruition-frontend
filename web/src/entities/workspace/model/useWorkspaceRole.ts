"use client";

import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import { fetchMembers, type WorkspaceRole } from "@/entities/workspace/api/members";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

const MEMBERS_STALE_TIME_MS = 60_000;

/**
 * 선택된 워크스페이스에서 본인의 역할. 워크스페이스 목록 응답에 역할이 없어 멤버 목록으로 구한다.
 * 확인 전·실패·멤버 아님은 null이다(OWNER 전용 화면은 null이면 숨긴다).
 */
export function useWorkspaceRole(): { role: WorkspaceRole | null; isOwner: boolean; isLoading: boolean } {
  const workspaceId = getSelectedWorkspaceId();
  const { data: me } = useMe();
  const members = useQuery({
    queryKey: ["workspace-members", workspaceId] as const,
    queryFn: () => fetchMembers(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: MEMBERS_STALE_TIME_MS
  });
  const role = me && members.data ? members.data.find((member) => member.user_id === me.id)?.role ?? null : null;
  return { role, isOwner: role === "OWNER", isLoading: members.isLoading || !me };
}
