import { useQuery } from "@tanstack/react-query";
import { useSelectedWorkspace } from "@/entities/workspace";
import { fetchAgentAutoApproval } from "../api/agentAutoApproval";
import { AGENT_AUTO_APPROVAL_QUERY_KEY } from "../lib/agentAutoApproval";

/** 계정 단위 자동 승인 설정. 경로의 워크스페이스는 멤버 확인용이라 지금 고른 것을 쓴다. */
export function useAgentAutoApprovalSettings() {
  const workspace = useSelectedWorkspace();
  return useQuery({
    queryKey: AGENT_AUTO_APPROVAL_QUERY_KEY,
    queryFn: () => fetchAgentAutoApproval(workspace!.id),
    enabled: Boolean(workspace),
    retry: false
  });
}
