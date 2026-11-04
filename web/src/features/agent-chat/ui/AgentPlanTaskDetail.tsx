import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import taskAcceptIcon from "@/shared/assets/svg/agent/task-accept.svg";
import taskRejectIcon from "@/shared/assets/svg/agent/task-reject.svg";
import taskBoltIcon from "@/shared/assets/svg/agent/task-bolt.svg";
import { readWorkspaceId } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useWorkspaceRole } from "@/entities/workspace";
import { documentDataQueryKey, fetchDocumentData } from "@/entities/wiki";
import { decideAgentPlan } from "../api/agentPlan";
import { agentPlanClarificationMessage, agentPlanFailureMessage, autoApprovedPlanNote, buildPlanPreviewTree, canApproveAgentPlan, canRetryAgentPlanRun, describePlanOperations, isAutoApprovedPlan, planOperationFailureReason, planOperationOutcome, planOperationResultLabel, splitPlanSummary, type AgentPlanRun, type PlanPreviewNode } from "../lib/agentPlan";
import { blockedEditRowIds, buildDocumentEditRows, documentEditApproval, documentEditApprovalHint, documentEditDecisionNote, documentEditMessageNotice, documentEditRunnableCount, documentEditRunNote, editPreviewNotice, isDocumentEditPlan } from "../lib/documentEditPlan";
import { buildFolderOrganizeView, folderOrganizeApproval, folderOrganizeCardHint, initialDeselectedRowIds } from "../lib/folderOrganize";
import { checkPlanAccess, checkRowAccess, PLAN_OPERATION_BLOCKED_NOTE, planAccessMessage } from "../lib/planAccess";
import { useDocumentEditPreviews } from "../model/useDocumentEditPreviews";
import { useFolderOrganizeDeselection } from "../model/useFolderOrganizeDeselection";
import { cx } from "@/shared/lib/classNames";
import { AgentAssetIcon } from "./AgentIcons";
import { DocumentEditPlanPreview } from "./DocumentEditPlanPreview";
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
          <span className={styles["plan-tree-name"]}>{node.name}</span>{node.failed ? <small className={styles["plan-tree-failed"]}>실패</small> : node.isNew && <small>새 폴더</small>}
        </summary>
        {node.children.length > 0 && <PlanTree nodes={node.children} depth={depth + 1} />}
      </details> : <div className={styles["plan-tree-file"]} style={rowStyle} title={node.name}>
        <span className={styles["plan-tree-slot"]} aria-hidden="true" />
        <span className={styles["plan-tree-name"]}>{name}</span>{node.failed && <small className={styles["plan-tree-failed"]}>실패</small>}{badge && <small>{badge}</small>}
      </div>}
    </li>;
    })}
  </ul>;
}

const PENDING_OPERATION_STATUSES = new Set(["pending", "planned"]);
const NO_OPERATION_IDS: ReadonlySet<string> = new Set();

/**
 * 작업 탭의 폴더 정리 계획 상세(Figma 1610:9529 작업 묶음): 정리 후 폴더 트리 미리보기, 상세 보기(항목별 변경),
 * 안내 문구와 승인·거절 버튼. run은 작업 목록이 폴링해 넘겨준다.
 * 모든 작업이 문서 편집인 계획은 폴더 트리 대신 문서별 변경 내용(DocumentEditPlanPreview)을 보여 준다.
 */
export function AgentPlanTaskDetail({
  turnId,
  action,
  run,
  message = null,
  runError,
  isRunFetching,
  onRefetch,
  onRetry,
  onOpenPreview
}: {
  turnId: string | null;
  action: string;
  run: AgentPlanRun | null;
  /** 이 작업의 결과 메시지. 문서 수정 계획에서 빠진 문서 안내가 담겨 온다. */
  message?: string | null;
  runError: unknown;
  isRunFetching: boolean;
  onRefetch: () => void;
  /** 계획 단계에서 실패한 요청을 다시 보낸다. 없으면 "다시 시도"를 숨긴다. */
  onRetry?: () => void;
  /** 폴더 정리 계획을 메인 영역의 미리보기 탭(Figma 1656:11542)으로 연다. 항목별로 골라 적용할 수 있다. */
  onOpenPreview?: () => void;
}) {
  const workspaceId = readWorkspaceId();
  const client = useQueryClient();
  const plan = run?.plan ?? null;
  const { role, isOwner } = useWorkspaceRole();
  // 워크스페이스 폴링이 받는 문서 트리 캐시를 그대로 구독한다(#66). 캐시가 비어 있을 때만 같은 조회로 채운다.
  const tree = useQuery({
    queryKey: documentDataQueryKey(workspaceId),
    queryFn: fetchDocumentData,
    select: (data) => data.tree,
    staleTime: Infinity,
    enabled: Boolean(plan) && Boolean(workspaceId),
    retry: false
  });
  const queryKey = ["agentPlan", workspaceId, turnId];
  const mutation = useMutation({
    // operationIds: 폴더 정리 부분 승인으로 실행할 작업. null·생략이면 계획 전체.
    mutationFn: ({ decision, operationIds }: { decision: "approve" | "reject"; operationIds?: readonly string[] | null }) =>
      decideAgentPlan(workspaceId, run!.id, decision, plan!, decision === "approve" ? operationIds : null),
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
  // 폴더 정리 수락은 미리보기 탭과 같은 선택으로 적용한다: 미리보기에서 바꾼 선택, 없으면 AI 권장 기본 선택
  // (suggested_selected false인 중복 의심·그에 기대는 작업 제외). 줄이 없는 계획은 지금처럼 전체 승인한다.
  const [userDeselectedIds, setUserDeselectedIds] = useFolderOrganizeDeselection(turnId, plan ? `${plan.id}:${plan.version}` : null);
  const isEditPlan = isDocumentEditPlan(plan);
  const editPreviews = useDocumentEditPreviews(run?.id, isEditPlan);
  const organizeRows = plan && (action === "folder_organize" || isEditPlan) ? buildFolderOrganizeView(plan, tree.data ?? []).rows : [];
  const deselectedIds = userDeselectedIds ?? initialDeselectedRowIds(organizeRows);
  const isWorkspaceOwner = role === null ? null : isOwner;
  // 문서 수정 계획은 권한으로 막힌 작업을 수락에 싣지 않는다. 고른 작업과 상관없는 판단이라 먼저 구한다.
  const editBlockedOperationIds = plan && isEditPlan && canDecide && tree.data
    ? checkPlanAccess(plan, tree.data, isWorkspaceOwner, null).blockedOperationIds
    : NO_OPERATION_IDS;
  const blockedRowIds = blockedEditRowIds(organizeRows, editBlockedOperationIds);
  const approval = plan && organizeRows.length > 0
    ? isEditPlan ? documentEditApproval(plan, organizeRows, deselectedIds, editBlockedOperationIds) : folderOrganizeApproval(plan, organizeRows, deselectedIds)
    : null;
  const purgedRows = organizeRows.filter((row) => row.isPurged);
  const approvalHint = !approval || !tree.data ? null : isEditPlan ? documentEditApprovalHint(approval, purgedRows.length, blockedRowIds.size) : folderOrganizeCardHint(approval);
  const editRows = plan && isEditPlan ? buildDocumentEditRows(plan, organizeRows, editPreviews.previews, tree.data ?? []) : [];
  // 눌러도 권한으로 실패할 계획은 수락을 막는다. 권한을 모르면 열어 두고 서버가 판단한다.
  const access = plan && canDecide && tree.data
    ? checkPlanAccess(plan, tree.data, isWorkspaceOwner, approval?.operationIds ?? null)
    : null;
  // 폴더 정리·문서 수정은 미리보기와 같이 줄 단위로 안내한다.
  // 문서 수정 계획에서 막힌 문서는 고를 수 없으므로 사용자가 뺀 문서와 상관없이 안내한다(영구 삭제된 줄만 뺀다).
  const rowAccess = access && organizeRows.length > 0
    ? checkRowAccess(access, organizeRows, isEditPlan ? new Set(purgedRows.map((row) => row.id)) : deselectedIds)
    : null;
  const accessVerdict = rowAccess?.verdict ?? access?.verdict;
  const accessMessage = rowAccess ? planAccessMessage({ ...rowAccess, unit: isEditPlan ? "문서" : "항목" }) : access && planAccessMessage(access);
  const isPreviewLoading = isEditPlan && editPreviews.state === "loading";
  const isPreviewExpired = isEditPlan && editPreviews.isExpired;
  const ready = canDecide && Boolean(tree.data) && !runError && !tree.error && (approval?.canApply ?? true) && accessVerdict !== "all_blocked"
    // 변경 내용을 받는 중이거나 변경안이 만료됐으면 수락하지 않는다. 받지 못한 경우(구 서버 등)는 안내하고 수락을 열어 둔다.
    && !isPreviewLoading && !isPreviewExpired;
  const clarificationMessage = agentPlanClarificationMessage(run);
  const busy = mutation.isPending || isRunFetching || tree.isFetching || (isEditPlan && editPreviews.isFetching);
  const failureMessage = agentPlanFailureMessage(run);
  const isFailed = failureMessage !== null;
  const canRetry = Boolean(onRetry) && canRetryAgentPlanRun(run);
  // AI가 대상 폴더 밖 작업을 뺐다는 안내는 접힌 상세 보기가 아니라 카드에 바로 보인다.
  const planSummary = splitPlanSummary(plan?.summary, run?.status);
  const note = clarificationMessage
    ?? (isEditPlan ? documentEditRunNote(run) : failureMessage)
    ?? (canDecide && accessVerdict !== "all_blocked"
      ? isEditPlan ? documentEditDecisionNote(documentEditRunnableCount({ selectedCount: approval?.selectedCount ?? 0, isExpired: isPreviewExpired })) : "폴더와 문서의 변경 내용을 확인한 뒤 승인해주세요. 승인한 항목만 저장됩니다."
      : null)
    ?? (plan && isAutoApprovedPlan(run) ? autoApprovedPlanNote(plan) : null);
  const messageNotice = isEditPlan ? documentEditMessageNotice(message, plan?.summary) : null;
  const previewNotice = isEditPlan && canDecide
    ? editPreviewNotice({ state: editPreviews.state, missingCount: editRows.filter((row) => !row.hunks && !row.isPurged).length, isExpired: isPreviewExpired })
    : null;

  function toggleEditRow(rowId: string) {
    const next = new Set(deselectedIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    setUserDeselectedIds(next);
  }

  return (
    <div className={styles["task-plan"]} aria-label={isEditPlan ? "문서 수정 계획" : action === "folder_organize" ? "폴더 정리 계획" : "워크스페이스 작업 계획"}>
      {plan && <>
        {preview?.summary && <p className={styles["plan-counts"]}>{preview.summary}</p>}
        {planSummary.scopeNote && <p className={styles["task-card-meta"]} role="status">{planSummary.scopeNote}</p>}
        {isEditPlan ? <>
          {messageNotice && <p className={styles["task-card-meta"]} role="status">{messageNotice}</p>}
          <DocumentEditPlanPreview
            rows={editRows}
            deselectedIds={deselectedIds}
            canSelect={canDecide && !isPreviewExpired}
            isAwaiting={canDecide}
            isLoadingPreviews={editPreviews.state === "loading"}
            isPreviewExpired={isPreviewExpired}
            blockedOperationIds={editBlockedOperationIds}
            blockedRowIds={blockedRowIds}
            onToggle={toggleEditRow}
          />
        </> : <>
          <div className={styles["plan-tree-region"]} aria-label="정리 후 폴더 구조">
            <PlanTree nodes={preview?.nodes ?? []} />
          </div>
          <details className={styles["plan-details"]}>
            <summary>상세 보기</summary>
            {planSummary.body && <p>{planSummary.body}</p>}
            <ol>
              {operations.map((operation) => (
                <li key={operation.id}>
                  <strong>{operation.description}</strong>
                  {operation.reason && <p>{operation.reason.normalize("NFC")}</p>}
                  {access?.blockedOperationIds.has(operation.id) && <p className={styles["plan-operation-blocked"]}>{PLAN_OPERATION_BLOCKED_NOTE}</p>}
                  {!PENDING_OPERATION_STATUSES.has(operation.status) && <small>{planOperationResultLabel(operation)}</small>}
                  {planOperationOutcome(operation) === "failed" && <p className={styles["plan-operation-blocked"]}>{planOperationFailureReason(operation)}</p>}
                </li>
              ))}
            </ol>
          </details>
        </>}
      </>}
      {note && <p className={styles["task-note"]} role={isFailed ? "alert" : undefined}>{note}</p>}
      {error && <p className={styles["task-error"]} role="alert">{typeof error === "string" ? error : getErrorMessage(error, "계획을 불러오지 못했습니다.")}</p>}
      {previewNotice && <p className={styles["task-card-meta"]} role="status">{previewNotice}</p>}
      {editPreviews.canRetry && canDecide && (
        <div className={styles["task-actions"]}>
          <button type="button" className={styles["task-pill"]} disabled={busy} onClick={editPreviews.refetch}>변경 내용 다시 불러오기</button>
        </div>
      )}
      {plan && onOpenPreview && !isEditPlan && (
        <div className={styles["task-actions"]}>
          <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onOpenPreview}>
            <AgentAssetIcon src={taskBoltIcon} size={12} />
            미리보기 탭 열기
          </button>
        </div>
      )}
      {canDecide && approvalHint && <p className={cx(styles["task-card-meta"], styles["task-decision-hint"])} role="status">{approvalHint}</p>}
      {accessMessage && <p className={cx(styles["task-card-meta"], styles["task-decision-hint"])} role="status">{accessMessage}</p>}
      {canRetry && !canDecide && (
        <div className={styles["task-actions"]}>
          <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onRetry}>
            <AgentAssetIcon src={taskBoltIcon} size={12} />
            다시 시도
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
            <button type="button" className={cx(styles["task-decision"], styles["is-danger"])} disabled={busy || Boolean(runError)} onClick={() => mutation.mutate({ decision: "reject" })}>
              <AgentAssetIcon src={taskRejectIcon} size={12} />
              거절
            </button>
            <button
              type="button"
              className={styles["task-decision"]}
              aria-label={isEditPlan ? "수락하고 수정" : action === "folder_organize" ? "수락하고 정리" : "수락하고 실행"}
              disabled={!ready || busy}
              title={accessVerdict === "all_blocked" ? accessMessage ?? undefined : previewNotice ?? undefined}
              onClick={() => mutation.mutate({ decision: "approve", operationIds: approval?.operationIds ?? null })}
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
