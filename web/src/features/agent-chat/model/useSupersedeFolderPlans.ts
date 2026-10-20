import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { decideAgentPlan } from "../api/agentPlan";
import type { AgentPlanRun } from "../lib/agentPlan";
import { supersededFolderPlans, type FolderPlanCandidate, type FolderPlanSupersession } from "../lib/folderPlanSupersede";

export type FolderPlanEntry = FolderPlanCandidate & { run: AgentPlanRun | null };

/**
 * 같은 대상 폴더에 새 폴더 정리 계획이 승인 대기에 도달하면, 그보다 앞선 같은 폴더의 승인 대기 run을 서버에 거절
 * (`POST agent/runs/{run_id}/reject`)해 정리한다. 거절이 끝나면 onSuperseded로 알려 열려 있던 앞선 run의 미리보기 탭을
 * 새 run으로 바꾸게 한다(작업 카드의 "새 실행으로 대체됨"은 run 상태로 판정한다). 같은 run은 한 화면에서 한 번만 거절을 요청한다.
 * 거절하지 못하면(이미 승인 처리됨 등) 그 run을 다시 받아 서버 상태를 따른다.
 */
export function useSupersedeFolderPlans({
  workspaceId,
  entries,
  onSuperseded
}: {
  workspaceId: string;
  /** 작업 탭에 보낸 순서대로 놓인 계획 작업과 그 run */
  entries: readonly FolderPlanEntry[];
  onSuperseded?: (supersession: FolderPlanSupersession) => void;
}): void {
  const client = useQueryClient();
  const supersessions = supersededFolderPlans(entries);
  const signature = supersessions.map(({ turnId, supersededBy }) => `${turnId}>${supersededBy}`).join("|");
  const requestedTurnIds = useRef(new Set<string>());
  const latest = useRef({ entries, onSuperseded });
  latest.current = { entries, onSuperseded };

  useEffect(() => {
    for (const supersession of supersededFolderPlans(latest.current.entries)) {
      const { turnId } = supersession;
      const run = latest.current.entries.find((entry) => entry.turnId === turnId)?.run;
      if (!run?.plan || requestedTurnIds.current.has(turnId)) continue;
      requestedTurnIds.current.add(turnId);
      const queryKey = ["agentPlan", workspaceId, turnId];
      const plan = run.plan;
      decideAgentPlan(workspaceId, run.id, "reject", plan)
        .then((updated) => {
          // 거절 응답은 plan을 생략할 수 있어 보던 계획은 남긴다(승인·거절 mutation과 같다).
          client.setQueryData(queryKey, { ...updated, plan: updated.plan ?? plan, request_summary: updated.request_summary ?? run.request_summary });
          latest.current.onSuperseded?.(supersession);
        })
        .catch(() => client.invalidateQueries({ queryKey }));
    }
    // 대체 관계가 바뀔 때만 다시 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, workspaceId]);
}
