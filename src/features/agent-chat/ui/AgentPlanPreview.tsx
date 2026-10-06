import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspaceId } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/errors";
import { documentDataQueryKey, fetchDocumentData } from "@/entities/wiki";
import { decideAgentPlan, fetchAgentPlanRun } from "../api/agentPlan";
import { agentPlanStatusLabel, buildPlanPreviewTree, canApproveAgentPlan, describePlanOperations, isPlanRunSettled, shouldPollAgentPlan, type PlanPreviewNode } from "../lib/agentPlan";
import styles from "./AgentChat.module.css";

function PlanTree({ nodes, depth = 0 }: { nodes: PlanPreviewNode[]; depth?: number }) {
  return <ul className={styles["plan-tree"]}>
    {nodes.map((node) => {
      const dot = node.folder ? -1 : node.name.lastIndexOf(".");
      const hasExtension = dot > 0 && dot < node.name.length - 1;
      const name = hasExtension ? node.name.slice(0, dot) : node.name;
      const badge = hasExtension ? node.name.slice(dot + 1).toUpperCase() : null;
      const rowStyle = { paddingLeft: 6 + depth * 14 };
      return <li key={node.id}>
      {node.folder ? <details open>
        <summary style={rowStyle} title={node.name}>
          <span className={styles["plan-tree-slot"]} aria-hidden="true">{node.children.length > 0 && <svg viewBox="0 0 8 8" fill="none"><path d="M2.5 1.25L5.25 4L2.5 6.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
          <span className={styles["plan-tree-name"]}>{node.name}</span>{node.isNew && <small>새 폴더</small>}
        </summary>
        {node.children.length > 0 && <PlanTree nodes={node.children} depth={depth + 1} />}
      </details> : <div className={styles["plan-tree-file"]} style={rowStyle} title={node.name}>
        <span className={styles["plan-tree-slot"]} aria-hidden="true" />
        <span className={styles["plan-tree-name"]}>{name}</span>{badge && <small>{badge}</small>}
      </div>}
    </li>;
    })}
  </ul>;
}

export function AgentPlanPreview({ turnId, action }: { turnId?: string; action: string }) {
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
      client.setQueryData(queryKey, { ...updated, plan: updated.plan ?? plan });
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
  const operations = plan ? describePlanOperations(plan, tree.data ?? []) : [];
  const preview = plan ? buildPlanPreviewTree(plan, tree.data ?? []) : null;
  const ready = canApproveAgentPlan(run) && Boolean(tree.data) && !query.error && !tree.error;
  const busy = mutation.isPending || query.isFetching || tree.isFetching;

  return (
    <section className={styles["plan-preview"]} aria-label="작업 계획 미리보기">
      <header>
        <strong>{action === "folder_organize" ? "폴더 정리" : "워크스페이스 작업"}</strong>
        <span role="status">{!run && error ? "계획 조회 실패" : agentPlanStatusLabel(run?.status)}</span>
      </header>
      {plan && <>
        <p className={styles["plan-counts"]}>{preview?.summary}</p>
        <div className={styles["plan-tree-region"]} aria-label="정리 후 폴더 구조">
          <PlanTree nodes={preview?.nodes ?? []} />
        </div>
        <details className={styles["plan-details"]}>
          <summary>상세 보기</summary>
          <p>{plan.summary.normalize("NFC")}</p>
          <ol>
          {operations.map((operation) => (
            <li key={operation.id}>
              <strong>{operation.description}</strong>
              {operation.reason && <p>{operation.reason.normalize("NFC")}</p>}
              {operation.status !== "pending" && <small>{({ succeeded: "완료", running: "실행 중", failed: "실패", skipped: "건너뜀", forbidden: "권한 없음", conflicted: "변경 충돌", verification_failed: "결과 확인 실패", cancelled: "취소됨", rolled_back: "복구됨" } as Record<string, string>)[operation.status] ?? "상태 확인 필요"}</small>}
            </li>
          ))}
          </ol>
        </details>
      </>}
      {run?.status === "awaiting_approval" && <p>폴더와 문서의 변경 내용을 확인한 뒤 승인해주세요.</p>}
      {run?.status === "clarification_required" && <p>원하는 정리 기준을 채팅에 더 구체적으로 알려주세요.</p>}
      {run && ["failed", "partial_failed", "conflicted", "rollback_failed"].includes(run.status) && <p role="alert">작업을 완료하지 못했습니다. 항목별 상태를 확인해주세요.</p>}
      {error && <p role="alert">{typeof error === "string" ? error : getErrorMessage(error, "계획을 불러오지 못했습니다.")}</p>}
      <footer>
        {error && turnId && <button type="button" disabled={busy} onClick={() => { mutation.reset(); void query.refetch(); void tree.refetch(); }}>다시 확인</button>}
        {canApproveAgentPlan(run) && <>
          <button type="button" disabled={busy || Boolean(query.error)} onClick={() => mutation.mutate("reject")}>거절</button>
          <button type="button" className={styles["is-primary"]} disabled={!ready || busy} onClick={() => mutation.mutate("approve")}>
            {mutation.isPending ? "처리 중" : action === "folder_organize" ? "승인하고 정리" : "승인하고 실행"}
          </button>
        </>}
      </footer>
    </section>
  );
}
