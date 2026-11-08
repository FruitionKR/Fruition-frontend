import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readWorkspaceId } from "@/shared/api/client";
import { ApiError } from "@/shared/lib/apiErrors";
import { fetchAgentRunEditPreviews } from "../api/agentPlan";
import { editPreviewExpiryDelayMs, isEditPreviewExpired } from "../lib/documentEditPreviews";

/** 문서 수정 계획의 변경 내용. 계획이 바뀌지 않는 한 내용도 같아 한 번만 받는다. */
export function useDocumentEditPreviews(runId: string | null | undefined, enabled: boolean, context?: { workspaceId: string; userId: string; runId: string }) {
  const workspaceId = context?.workspaceId ?? readWorkspaceId();
  const query = useQuery({
    queryKey: context ? ["mcpApproval", context.userId, workspaceId, context.runId, "editPreviews"] : ["agentEditPreviews", workspaceId, runId],
    queryFn: ({ signal }) => fetchAgentRunEditPreviews(workspaceId, runId!, signal),
    enabled: enabled && Boolean(runId) && Boolean(workspaceId),
    retry: false,
    staleTime: Infinity
  });
  const expiresAt = query.data?.expires_at ?? null;
  // 카드를 보는 동안 만료 시각이 지나면 수락을 바로 막는다.
  const [, setExpiredTick] = useState(0);
  useEffect(() => {
    const delay = editPreviewExpiryDelayMs(expiresAt, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => setExpiredTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  return {
    previews: query.data ?? null,
    state: query.isError ? "error" as const : query.data ? "ready" as const : "loading" as const,
    isExpired: isEditPreviewExpired(expiresAt, Date.now()),
    isFetching: query.isFetching,
    // 404는 구 서버·만료라 다시 받아도 같다.
    canRetry: query.isError && !(query.error instanceof ApiError && query.error.status === 404),
    refetch: () => { void query.refetch(); }
  };
}
