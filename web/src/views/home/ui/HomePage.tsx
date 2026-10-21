"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HomeWorkspace } from "@/widgets/workspace";
import { useMe, useSignOut } from "@/entities/user";
import { fetchWorkspaces } from "@/entities/workspace";
import { clearSelectedWorkspaceId, getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getWorkspaceGoneVersion, isWorkspaceGone, subscribeWorkspaceGone } from "@/shared/lib/workspaceAccess";
import { LoadingOverlay } from "@/shared/ui/LoadingOverlay";
import { WorkspaceGoneState } from "./WorkspaceGoneState";

export default function HomePage() {
  const router = useRouter();
  const { signOut } = useSignOut();
  // SSR에서는 null이지만 어차피 로딩 오버레이만 렌더링하므로 hydration 불일치가 없다.
  const selectedWorkspaceId = getSelectedWorkspaceId();
  const hasWorkspace = Boolean(selectedWorkspaceId);
  const queryClient = useQueryClient();
  // 열어 둔 워크스페이스에서 내보내졌거나 삭제되면(조회가 404 WORKSPACE_NOT_FOUND) 화면을 안내로 바꾼다.
  useSyncExternalStore(subscribeWorkspaceGone, getWorkspaceGoneVersion, () => 0);
  const isGone = isWorkspaceGone(selectedWorkspaceId);

  // access token은 메모리에만 있으므로 서버 검증 과정에서 HttpOnly refresh 쿠키로 복구한다.
  const { isSuccess, isError } = useMe({ enabled: hasWorkspace });

  // 저장된 workspace_id가 삭제됐거나 다른 계정 것일 수 있어, 소유 목록과 대조해 검증한다.
  const { data: workspaceList, isError: isWorkspaceListError } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    staleTime: Infinity,
    enabled: hasWorkspace && isSuccess
  });
  const isStaleWorkspace =
    workspaceList != null &&
    !(workspaceList.workspaces ?? []).some((workspace) => workspace.id === selectedWorkspaceId);

  useEffect(() => {
    if (!hasWorkspace) router.replace("/workspaces");
  }, [hasWorkspace, router]);

  // 존재하지 않는 워크스페이스면 선택을 지우고 선택 화면으로 돌려보낸다.
  useEffect(() => {
    if (!isStaleWorkspace) return;
    clearSelectedWorkspaceId();
    router.replace("/workspaces");
  }, [isStaleWorkspace, router]);

  // 접근할 수 없게 된 워크스페이스의 조회를 멈추고 지난 데이터(트리·문서·그래프 등)를 캐시에서 지운다.
  // 폴링하던 화면은 아래에서 안내로 바꿔 내리고, 남은 요청은 apiFetch가 보내지 않는다.
  useEffect(() => {
    if (!isGone || !selectedWorkspaceId) return;
    const isWorkspaceQuery = (queryKey: readonly unknown[]) => queryKey.includes(selectedWorkspaceId) || queryKey[0] === "backendData";
    void queryClient.cancelQueries({ predicate: (query) => isWorkspaceQuery(query.queryKey) });
    queryClient.removeQueries({ predicate: (query) => isWorkspaceQuery(query.queryKey) });
  }, [isGone, queryClient, selectedWorkspaceId]);

  // 세션 만료 시 캐시·인증 상태를 정리하고 로그인 화면으로 보낸다.
  useEffect(() => {
    if (isError) void signOut();
  }, [isError, signOut]);

  if (isGone) return <WorkspaceGoneState />;
  // 목록 조회가 실패하면 검증을 생략하고 홈을 렌더한다(무한 로딩 방지). 잘못된 id는 화면 오류로 드러난다.
  if (!hasWorkspace || !isSuccess || (workspaceList == null && !isWorkspaceListError) || isStaleWorkspace) {
    return <LoadingOverlay message="워크스페이스 불러오는 중…" />;
  }
  // HomeWorkspace는 useSearchParams로 URL(?doc=·?view=graph 등)을 읽으므로 Suspense 경계 안에 둔다.
  return (
    <Suspense fallback={<LoadingOverlay message="워크스페이스 불러오는 중…" />}>
      <HomeWorkspace />
    </Suspense>
  );
}
