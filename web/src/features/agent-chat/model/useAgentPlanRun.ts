import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspaceId } from "@/shared/api/client";
import { documentDataQueryKey, fetchDocumentData } from "@/entities/wiki";
import { decideAgentPlan, fetchAgentPlanRun } from "../api/agentPlan";
import { agentPlanClarificationMessage, canApproveAgentPlan, isPlanRunSettled, shouldPollAgentPlan } from "../lib/agentPlan";

/**
 * 작업 turn의 계획(run)과 승인·거절. 작업 탭 카드(AgentTaskBody)와 폴더 정리 미리보기 화면이 같은 쿼리 키를 공유해
 * 둘 다 떠 있어도 한 번만 폴링한다.
 */
export function useAgentPlanRun(turnId: string | undefined) {
  const workspaceId = getWorkspaceId();
  const client = useQueryClient();
  const queryKey = ["agentPlan", workspaceId, turnId];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchAgentPlanRun(workspaceId, turnId!, signal),
    enabled: Boolean(turnId),
    retry: false,
    refetchInterval: (current) => !current.state.error && shouldPollAgentPlan(current.state.data?.status) ? 3000 : false,
    // 이미 끝난 계획은 상태가 바뀌지 않으므로, 다시 마운트돼도 turn·run을 다시 받지 않는다(#66).
    staleTime: (current) => shouldPollAgentPlan(current.state.data?.status) ? 0 : Infinity
  });
  // 워크스페이스 폴링이 받는 문서 트리 캐시를 그대로 구독한다. 폴링이 갱신하면 미리보기도 따라가고,
  // 마운트할 때 트리를 따로 받지 않는다(#66). 캐시가 비어 있을 때만 같은 조회로 채운다.
  const tree = useQuery({
    queryKey: documentDataQueryKey(workspaceId),
    queryFn: fetchDocumentData,
    select: (data) => data.tree,
    staleTime: Infinity,
    enabled: Boolean(query.data?.plan),
    retry: false
  });
  const run = query.data;
  const runStatus = run?.status;
  const plan = run?.plan;
  const mutation = useMutation({
    mutationFn: (decision: "approve" | "reject") => decideAgentPlan(workspaceId, run!.id, decision, plan!),
    onSuccess: (updated) => {
      // 승인 응답은 plan을 생략하므로 검토했던 목록은 다음 조회까지 유지한다.
      client.setQueryData(queryKey, { ...updated, plan: updated.plan ?? plan, request_summary: updated.request_summary ?? run?.request_summary });
    },
    onSettled: () => client.invalidateQueries({ queryKey })
  });
  // 이미 끝난 계획이 다시 마운트될 때마다 문서·트리·그래프를 다시 받지 않도록 전이를 볼 때만 갱신한다(#66).
  const previousStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (isPlanRunSettled(previousStatus.current, runStatus)) {
      void client.invalidateQueries({ queryKey: ["backendData"] });
    }
    previousStatus.current = runStatus;
  }, [client, runStatus]);

  const error = !turnId ? "이 답변에 계획 조회 정보가 없습니다. 다시 요청해주세요."
    : query.error || tree.error || mutation.error;

  return {
    run,
    plan,
    tree: tree.data,
    mutation,
    error,
    busy: mutation.isPending || query.isFetching || tree.isFetching,
    ready: canApproveAgentPlan(run) && Boolean(tree.data) && !query.error && !tree.error,
    hasQueryError: Boolean(query.error),
    clarificationMessage: agentPlanClarificationMessage(run),
    retry: () => {
      mutation.reset();
      void query.refetch();
      void tree.refetch();
    }
  };
}
