"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/entities/user";
import { fetchMembers, type WorkspaceRole } from "@/entities/workspace/api/members";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { subscribeWorkspacePermissionDenied } from "@/shared/lib/workspacePermissionSignal";

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
    staleTime: MEMBERS_STALE_TIME_MS,
    // OWNER가 권한을 바꾸면 다른 탭에서 돌아올 때 바로 맞춘다(staleTime과 상관없이).
    refetchOnWindowFocus: "always"
  });
  // 서버가 권한 부족(403)으로 거절하면 본인 권한이 바뀐 것이므로 바로 다시 받는다. 이 훅은 여러 컴포넌트가 함께 쓰므로
  // 같은 key로 구독해 신호 하나에 한 번만 다시 받고, 이미 받는 중이면 그 요청을 이어 쓴다(cancelRefetch: false).
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspacePermissionDenied((deniedWorkspaceId) => {
      if (deniedWorkspaceId !== workspaceId) return;
      void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] }, { cancelRefetch: false });
    }, `workspace-members:${workspaceId}`);
  }, [queryClient, workspaceId]);
  const self = me && members.data ? members.data.find((member) => member.user_id === me.id) : undefined;
  const role = self?.role ?? null;
  return { role, permissions: self?.permissions ?? NO_PERMISSIONS, isOwner: role === "OWNER", isLoading: members.isLoading || !me };
}
