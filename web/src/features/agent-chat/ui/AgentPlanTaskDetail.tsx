import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import taskAcceptIcon from "@/shared/assets/svg/agent/task-accept.svg";
import taskRejectIcon from "@/shared/assets/svg/agent/task-reject.svg";
import taskBoltIcon from "@/shared/assets/svg/agent/task-bolt.svg";
import { getWorkspaceId } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { documentDataQueryKey, fetchDocumentData } from "@/entities/wiki";
import { decideAgentPlan } from "../api/agentPlan";
import { agentPlanClarificationMessage, buildPlanPreviewTree, canApproveAgentPlan, describePlanOperations, isOperationNotSelected, type AgentPlanRun, type PlanPreviewNode } from "../lib/agentPlan";
import { cx } from "@/shared/lib/classNames";
import { AgentAssetIcon } from "./AgentIcons";
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

const OPERATION_STATUS_LABELS: Record<string, string> = {
  succeeded: "완료", completed: "완료", running: "실행 중", failed: "실패", skipped: "건너뜀", forbidden: "권한 없음",
  conflicted: "변경 충돌", verification_failed: "결과 확인 실패", cancelled: "취소됨", rolled_back: "복구됨"
};
const PENDING_OPERATION_STATUSES = new Set(["pending", "planned"]);

/**
 * 작업 탭의 폴더 정리 계획 상세(Figma 1610:9529 작업 묶음): 정리 후 폴더 트리 미리보기, 상세 보기(항목별 변경),
 * 안내 문구와 승인·거절 버튼. run은 작업 목록이 폴링해 넘겨준다.
 */
export function AgentPlanTaskDetail({
  turnId,
  action,
  run,
  runError,
  isRunFetching,
  onRefetch,
  onOpenPreview
}: {
  turnId: string | null;
  action: string;
  run: AgentPlanRun | null;
  runError: unknown;
  isRunFetching: boolean;
  onRefetch: () => void;
  /** 폴더 정리 계획을 메인 영역의 미리보기 탭(Figma 1656:11542)으로 연다. 항목별로 골라 적용할 수 있다. */
  onOpenPreview?: () => void;
}) {
  const workspaceId = getWorkspaceId();
  const client = useQueryClient();
  const plan = run?.plan ?? null;
  // 워크스페이스 폴링이 받는 문서 트리 캐시를 그대로 구독한다(#66). 캐시가 비어 있을 때만 같은 조회로 채운다.
  const tree = useQuery({
    queryKey: documentDataQueryKey(workspaceId),
    queryFn: fetchDocumentData,
    select: (data) => data.tree,
    staleTime: Infinity,
    enabled: Boolean(plan),
    retry: false
  });
  const queryKey = ["agentPlan", workspaceId, turnId];
  const mutation = useMutation({
    mutationFn: (decision: "approve" | "reject") => decideAgentPlan(workspaceId, run!.id, decision, plan!),
    onSuccess: (updated) => {
      // 승인 응답은 plan을 생략하므로 검토했던 목록은 다음 조회까지 유지한다.
      client.setQueryData(queryKey, { ...updated, plan: updated.plan ?? plan, request_summary: updated.request_summary ?? run?.request_summary });
    },
    onSettled: () => client.invalidateQueries({ queryKey })
  });

  const error = !turnId ? "이 작업에 계획 조회 정보가 없습니다. 다시 요청해주세요." : runError || tree.error || mutation.error;
  const operations = plan ? describePlanOperations(plan, tree.data ?? []) : [];
  const preview = plan ? buildPlanPreviewTree(plan, tree.data ?? []) : null;
  const canDecide = canApproveAgentPlan(run);
  const ready = canDecide && Boolean(tree.data) && !runError && !tree.error;
  const clarificationMessage = agentPlanClarificationMessage(run);
  const busy = mutation.isPending || isRunFetching || tree.isFetching;
  const isFailed = run !== null && ["failed", "partial_failed", "conflicted", "rollback_failed"].includes(run.status);
  const note = clarificationMessage
    ?? (isFailed ? "작업을 완료하지 못했습니다. 상세 보기에서 항목별 상태를 확인해주세요." : null)
    ?? (canDecide ? "폴더와 문서의 변경 내용을 확인한 뒤 승인해주세요. 승인한 항목만 저장됩니다." : null);

  return (
    <div className={styles["task-plan"]} aria-label={action === "folder_organize" ? "폴더 정리 계획" : "워크스페이스 작업 계획"}>
      {plan && <>
        {preview?.summary && <p className={styles["plan-counts"]}>{preview.summary}</p>}
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
                {!PENDING_OPERATION_STATUSES.has(operation.status) && <small>{isOperationNotSelected(operation) ? "제외됨" : OPERATION_STATUS_LABELS[operation.status] ?? "상태 확인 필요"}</small>}
              </li>
            ))}
          </ol>
        </details>
      </>}
      {note && <p className={styles["task-note"]} role={isFailed ? "alert" : undefined}>{note}</p>}
      {error && <p className={styles["task-error"]} role="alert">{typeof error === "string" ? error : getErrorMessage(error, "계획을 불러오지 못했습니다.")}</p>}
      {plan && onOpenPreview && (
        <div className={styles["task-actions"]}>
          <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onOpenPreview}>
            <AgentAssetIcon src={taskBoltIcon} size={12} />
            미리보기 탭 열기
          </button>
        </div>
      )}
      {(canDecide || (error && turnId)) && (
        // 거절·수락 (Figma 1671:13230): 오른쪽 정렬, 빨강·주 색 바탕
        <div className={styles["task-decisions"]}>
          {error && turnId && (
            <button type="button" className={styles["task-pill"]} disabled={busy} onClick={() => { mutation.reset(); onRefetch(); void tree.refetch(); }}>
              다시 확인
            </button>
          )}
          {canDecide && <>
            <button type="button" className={cx(styles["task-decision"], styles["is-danger"])} disabled={busy || Boolean(runError)} onClick={() => mutation.mutate("reject")}>
              <AgentAssetIcon src={taskRejectIcon} size={12} />
              거절
            </button>
            <button
              type="button"
              className={styles["task-decision"]}
              aria-label={action === "folder_organize" ? "수락하고 정리" : "수락하고 실행"}
              disabled={!ready || busy}
              onClick={() => mutation.mutate("approve")}
            >
              <AgentAssetIcon src={taskAcceptIcon} size={12} />
              {mutation.isPending ? "처리 중" : "수락"}
            </button>
          </>}
        </div>
      )}
    </div>
  );
}
