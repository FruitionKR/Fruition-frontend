import { getErrorMessage } from "@/shared/lib/apiErrors";
import { agentPlanStatusLabel, buildPlanPreviewTree, canApproveAgentPlan, describePlanOperations, type PlanPreviewNode } from "../lib/agentPlan";
import { useAgentPlanRun } from "../model/useAgentPlanRun";
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
  const { run, plan, tree, mutation, error, busy, ready, hasQueryError, clarificationMessage, retry } = useAgentPlanRun(turnId);
  const operations = plan ? describePlanOperations(plan, tree ?? []) : [];
  const preview = plan ? buildPlanPreviewTree(plan, tree ?? []) : null;

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
      {clarificationMessage && <p>{clarificationMessage}</p>}
      {run && ["failed", "partial_failed", "conflicted", "rollback_failed"].includes(run.status) && <p role="alert">작업을 완료하지 못했습니다. 항목별 상태를 확인해주세요.</p>}
      {error && <p role="alert">{typeof error === "string" ? error : getErrorMessage(error, "계획을 불러오지 못했습니다.")}</p>}
      <footer>
        {error && turnId && <button type="button" disabled={busy} onClick={retry}>다시 확인</button>}
        {canApproveAgentPlan(run) && <>
          <button type="button" disabled={busy || hasQueryError} onClick={() => mutation.mutate("reject")}>거절</button>
          <button type="button" className={styles["is-primary"]} disabled={!ready || busy} onClick={() => mutation.mutate("approve")}>
            {mutation.isPending ? "처리 중" : action === "folder_organize" ? "승인하고 정리" : "승인하고 실행"}
          </button>
        </>}
      </footer>
    </section>
  );
}
