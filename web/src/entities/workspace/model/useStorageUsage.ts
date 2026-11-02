"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchStorageUsage } from "@/entities/workspace/api/storage";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

/** 사용자 단위 값이라 워크스페이스 id를 키에 넣지 않는다. */
export const STORAGE_USAGE_QUERY_KEY = ["storage-usage"] as const;

/** 내 저장 공간 사용량. 실패해도 업로드를 막지 않도록 다시 시도하지 않고 화면은 표시만 숨긴다. */
export function useStorageUsage() {
  const workspaceId = getSelectedWorkspaceId();
  return useQuery({
    queryKey: STORAGE_USAGE_QUERY_KEY,
    queryFn: () => fetchStorageUsage(workspaceId!),
    enabled: Boolean(workspaceId),
    retry: false
  });
}

/** 업로드 성공·문서 삭제·용량 초과 거절 뒤 사용량을 다시 받는다. */
export function invalidateStorageUsage(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: STORAGE_USAGE_QUERY_KEY });
}
