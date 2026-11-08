import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import taskAcceptIcon from "@/shared/assets/svg/agent/task-accept.svg";
import taskRejectIcon from "@/shared/assets/svg/agent/task-reject.svg";
import taskBoltIcon from "@/shared/assets/svg/agent/task-bolt.svg";
import { readWorkspaceId } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useWorkspaceRole } from "@/entities/workspace";
import { documentDataQueryKey, fetchDocumentData, fetchDocumentDataForWorkspace } from "@/entities/wiki";
import { decideAgentPlan } from "../api/agentPlan";
import { fetchTrashDocuments, TRASH_QUERY_KEY } from "@/entities/document/api/trash";
import { startedPlanTurns, agentPlanClarificationMessage, agentPlanFailureMessage, autoApprovedPlanNote, buildPlanPreviewTree, canApproveAgentPlan, canRetryAgentPlanRun, describePlanOperations, isAutoApprovedPlan, planOperationFailureReason, planOperationOutcome, planOperationResultLabel, splitPlanSummary, type AgentPlanOperation, type AgentPlanRun, type McpApprovalQuote, type McpPriceSnapshot, type PlanPreviewNode } from "../lib/agentPlan";
import { blockedEditRowIds, buildDocumentEditRows, documentEditRowsNeedTrash, documentEditApproval, documentEditApprovalHint, documentEditDecisionNote, documentEditMessageNotice, documentEditRunnableCount, documentEditRunNote, editPreviewNotice, isDocumentEditPlan } from "../lib/documentEditPlan";
import { buildFolderOrganizeView, folderOrganizeApproval, folderOrganizeCardHint, initialDeselectedRowIds } from "../lib/folderOrganize";
import { checkPlanAccess, checkRowAccess, planAccessMessage } from "../lib/planAccess";
import { useDocumentEditPreviews } from "../model/useDocumentEditPreviews";
import type { AgentDocumentEditPreview } from "../lib/documentEditPreviews";
import { useFolderOrganizeDeselection } from "../model/useFolderOrganizeDeselection";
import { cx } from "@/shared/lib/classNames";
import { AgentAssetIcon } from "./AgentIcons";
import { DocumentEditDiff, DocumentEditPlanPreview } from "./DocumentEditPlanPreview";
import styles from "./AgentChat.module.css";
import { useTranslations } from "next-intl";
import { agentChatErrorMessage } from "../lib/agentChatError";
import {
  initialMcpSelectedOperationIds,
  mcpApprovalSelectionKey,
  mcpPriceSnapshotForSelection,
  toggleMcpOperationSelection,
  validMcpOperationSelection
} from "@/features/mcp-approval/lib/mcpApproval";

function PlanTree({ nodes, depth = 0 }: { nodes: PlanPreviewNode[]; depth?: number }) {
  const t = useTranslations("agentChat");
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
          <span className={styles["plan-tree-name"]}>{node.name}</span>{node.failed ? <small className={styles["plan-tree-failed"]}>{t("plan.operationStatus.failed")}</small> : node.isNew && <small>{t("plan.tree.newFolder")}</small>}
        </summary>
        {node.children.length > 0 && <PlanTree nodes={node.children} depth={depth + 1} />}
      </details> : <div className={styles["plan-tree-file"]} style={rowStyle} title={node.name}>
        <span className={styles["plan-tree-slot"]} aria-hidden="true" />
        <span className={styles["plan-tree-name"]}>{name}</span>{node.failed && <small className={styles["plan-tree-failed"]}>{t("plan.operationStatus.failed")}</small>}{badge && <small>{badge}</small>}
      </div>}
    </li>;
    })}
  </ul>;
}

const PENDING_OPERATION_STATUSES = new Set(["pending", "planned"]);
const NO_OPERATION_IDS: ReadonlySet<string> = new Set();
const TRASH_STALE_MS = 30_000;

function validMcpContentPreview(operation: AgentPlanOperation, preview: AgentDocumentEditPreview): boolean {
  if (preview.operation_id !== operation.id || preview.tool_name !== operation.tool_name || !preview.display_name.trim() || !Array.isArray(preview.hunks)
    || !Number.isSafeInteger(preview.added_lines) || preview.added_lines < 0
    || !Number.isSafeInteger(preview.removed_lines) || preview.removed_lines < 0) return false;
  return operation.tool_name === "create_document"
    ? preview.document_id === null && preview.base_version === null
    : operation.tool_name === "apply_document_edit" && Boolean(preview.document_id?.trim()) && Number.isSafeInteger(preview.base_version) && (preview.base_version ?? 0) > 0;
}

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
  onOpenPreview,
  mcpContext,
  mcpQuote,
  onMcpSelectionChange,
  approvalDisabledReason,
  errorMessage
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
  /** 공유 카드를 route workspace에서 안전하게 읽기 위한 MCP 전용 cache/fetch scope. */
  mcpContext?: { workspaceId: string; userId: string; runId: string };
  mcpQuote?: McpApprovalQuote | null;
  onMcpSelectionChange?: (selection: { operationIds: readonly string[]; priceSnapshot: McpPriceSnapshot | null }) => void;
  approvalDisabledReason?: string | null;
  errorMessage?: (error: unknown) => string;
}) {
  const t = useTranslations("agentChat");
  const tShared = useTranslations("shared");
  const workspaceId = mcpContext?.workspaceId ?? readWorkspaceId();
  const client = useQueryClient();
  const plan = run?.plan ?? null;
  const { role, isOwner } = useWorkspaceRole(mcpContext);
  // 워크스페이스 폴링이 받는 문서 트리 캐시를 그대로 구독한다(#66). 캐시가 비어 있을 때만 같은 조회로 채운다.
  const tree = useQuery({
    queryKey: mcpContext ? ["mcpApproval", mcpContext.userId, workspaceId, mcpContext.runId, "documents"] : documentDataQueryKey(workspaceId),
    queryFn: mcpContext ? () => fetchDocumentDataForWorkspace(workspaceId) : fetchDocumentData,
    select: (data) => data.tree,
    staleTime: Infinity,
    enabled: Boolean(plan) && Boolean(workspaceId),
    retry: false
  });
  const queryKey = mcpContext ? ["mcpApproval", mcpContext.userId, workspaceId, mcpContext.runId] : ["agentPlan", workspaceId, turnId];
  const operations = plan ? describePlanOperations(plan, tree.data ?? [], t) : [];
  const preview = plan ? buildPlanPreviewTree(plan, tree.data ?? [], t) : null;
  const canDecide = canApproveAgentPlan(run);
  const hasMcpContext = Boolean(mcpContext);
  const mcpSelectionKey = mcpContext && plan
    ? mcpApprovalSelectionKey(mcpContext.userId, workspaceId, mcpContext.runId, plan)
    : null;
  const initialMcpSelection = useMemo(() => plan && hasMcpContext ? initialMcpSelectedOperationIds(plan) : [], [hasMcpContext, plan]);
  const [mcpSelection, setMcpSelection] = useState<{ key: string | null; ids: string[] }>({ key: mcpSelectionKey, ids: initialMcpSelection });
  const [mcpSelectionNotice, setMcpSelectionNotice] = useState<string | null>(null);
  const selectedMcpOperationIds = mcpSelection.key === mcpSelectionKey ? mcpSelection.ids : initialMcpSelection;
  const mcpPriceSnapshot = useMemo(
    () => mcpQuote ? mcpPriceSnapshotForSelection(mcpQuote, selectedMcpOperationIds) : null,
    [mcpQuote, selectedMcpOperationIds]
  );
  const mcpSelectionValid = Boolean(plan && mcpContext && validMcpOperationSelection(plan, selectedMcpOperationIds));
  const mutation = useMutation({
    // MCP는 항상 검토한 canonical operationIds와 그 선택으로 다시 계산한 가격을 함께 보낸다.
    mutationFn: ({ decision, operationIds }: { decision: "approve" | "reject"; operationIds?: readonly string[] | null }) =>
      decideAgentPlan(
        workspaceId,
        run!.id,
        decision,
        plan!,
        decision === "approve" ? operationIds : null,
        decision === "approve" && mcpContext ? mcpPriceSnapshot : null
      ),
    onSuccess: (updated, { decision }) => {
      if (decision === "approve" && turnId) startedPlanTurns.mark(turnId);
      // 승인 응답은 plan을 생략하므로 검토했던 목록은 다음 조회까지 유지한다.
      client.setQueryData(queryKey, {
        ...updated,
        plan: updated.plan ?? plan,
        request_summary: updated.request_summary ?? run?.request_summary,
        origin: updated.origin ?? run?.origin,
        grant_id: updated.grant_id ?? run?.grant_id,
        client_id: updated.client_id ?? run?.client_id,
        policy_generation: updated.policy_generation ?? run?.policy_generation,
        mcp_approval_quote: updated.mcp_approval_quote ?? run?.mcp_approval_quote,
        mcp_settlement: updated.mcp_settlement ?? run?.mcp_settlement
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey })
  });
  const error = !turnId ? t("plan.missingTaskTurn") : runError || tree.error || mutation.error;
  // 폴더 정리 수락은 미리보기 탭과 같은 선택으로 적용한다: 미리보기에서 바꾼 선택, 없으면 AI 권장 기본 선택
  // (suggested_selected false인 중복 의심·그에 기대는 작업 제외). 줄이 없는 계획은 지금처럼 전체 승인한다.
  const [userDeselectedIds, setUserDeselectedIds] = useFolderOrganizeDeselection(turnId, plan ? `${plan.id}:${plan.version}` : null);
  const isEditPlan = isDocumentEditPlan(plan);
  const mcpContentOperations = plan?.operations.filter((operation) => operation.tool_name === "apply_document_edit" || operation.tool_name === "create_document") ?? [];
  const editPreviews = useDocumentEditPreviews(run?.id, isEditPlan || Boolean(mcpContext && mcpContentOperations.length > 0), mcpContext);
  const contentPreviewByOperation = new Map((editPreviews.previews?.items ?? []).map((item) => [item.operation_id, item]));
  const selectedMcpContentOperations = mcpContentOperations.filter((operation) => selectedMcpOperationIds.includes(operation.id));
  const missingMcpContentPreviews = selectedMcpContentOperations.filter((operation) => {
    const item = contentPreviewByOperation.get(operation.id);
    return !item || !validMcpContentPreview(operation, item);
  });
  const organizeRows = plan && (action === "folder_organize" || isEditPlan) ? buildFolderOrganizeView(plan, tree.data ?? [], undefined, t).rows : [];
  const deselectedIds = userDeselectedIds ?? initialDeselectedRowIds(organizeRows);
  const isWorkspaceOwner = role === null ? null : isOwner;
  // 문서 수정 계획은 권한으로 막힌 작업을 수락에 싣지 않는다. 고른 작업과 상관없는 판단이라 먼저 구한다.
  const editBlockedOperationIds = plan && isEditPlan && canDecide && tree.data
    ? checkPlanAccess(plan, tree.data, isWorkspaceOwner, null).blockedOperationIds
    : NO_OPERATION_IDS;
  const blockedRowIds = blockedEditRowIds(organizeRows, editBlockedOperationIds);
  const approval = !mcpContext && plan && organizeRows.length > 0
    ? isEditPlan ? documentEditApproval(plan, organizeRows, deselectedIds, editBlockedOperationIds) : folderOrganizeApproval(plan, organizeRows, deselectedIds)
    : null;
  const purgedRows = organizeRows.filter((row) => row.isPurged);
  const approvalHint = !approval || !tree.data ? null : isEditPlan ? documentEditApprovalHint(approval, purgedRows.length, blockedRowIds.size, t) : folderOrganizeCardHint(approval, t);
  // 트리에 없는 문서가 있는 카드에서만 휴지통을 읽는다. 못 읽으면(권한 등) 지금 문구를 쓴다.
  const trash = useQuery({
    queryKey: TRASH_QUERY_KEY(workspaceId),
    queryFn: fetchTrashDocuments,
    enabled: isEditPlan && documentEditRowsNeedTrash(organizeRows, tree.data),
    retry: false,
    // 권한으로 거절되면 카드가 다시 마운트돼도 또 묻지 않는다.
    retryOnMount: false,
    staleTime: TRASH_STALE_MS
  });
  const editRows = plan && isEditPlan ? buildDocumentEditRows(plan, organizeRows, editPreviews.previews, tree.data ?? [], trash.data ?? [], t) : [];
  // 눌러도 권한으로 실패할 계획은 수락을 막는다. 권한을 모르면 열어 두고 서버가 판단한다.
  const approvalOperationIds = mcpContext ? selectedMcpOperationIds : approval?.operationIds ?? null;
  const access = plan && canDecide && tree.data
    ? checkPlanAccess(plan, tree.data, isWorkspaceOwner, approvalOperationIds)
    : null;
  // 폴더 정리·문서 수정은 미리보기와 같이 줄 단위로 안내한다.
  // 문서 수정 계획에서 막힌 문서는 고를 수 없으므로 사용자가 뺀 문서와 상관없이 안내한다(영구 삭제된 줄만 뺀다).
  const rowAccess = !mcpContext && access && organizeRows.length > 0
    ? checkRowAccess(access, organizeRows, isEditPlan ? new Set(purgedRows.map((row) => row.id)) : deselectedIds)
    : null;
  const accessVerdict = rowAccess?.verdict ?? access?.verdict;
  const accessMessage = rowAccess ? planAccessMessage({ ...rowAccess, unit: isEditPlan ? "document" : "item" }, t) : access && planAccessMessage(access, t);
  const isPreviewLoading = (isEditPlan || selectedMcpContentOperations.length > 0) && editPreviews.state === "loading";
  const isPreviewExpired = (isEditPlan || selectedMcpContentOperations.length > 0) && editPreviews.isExpired;
  const ready = canDecide && !approvalDisabledReason && Boolean(tree.data) && !runError && !tree.error && (approval?.canApply ?? true) && accessVerdict !== "all_blocked"
    // 변경 내용을 받는 중이거나 변경안이 만료됐으면 수락하지 않는다. 받지 못한 경우(구 서버 등)는 안내하고 수락을 열어 둔다.
    && !isPreviewLoading && !isPreviewExpired
    && (!mcpContext || (mcpSelectionValid && Boolean(mcpPriceSnapshot) && editPreviews.state !== "error" && missingMcpContentPreviews.length === 0));
  const clarificationMessage = agentPlanClarificationMessage(run, t);
  const busy = mutation.isPending || isRunFetching || tree.isFetching || ((isEditPlan || Boolean(mcpContext && mcpContentOperations.length > 0)) && editPreviews.isFetching);
  const failureMessage = agentPlanFailureMessage(run, t);
  const isFailed = failureMessage !== null;
  const canRetry = Boolean(onRetry) && canRetryAgentPlanRun(run);
  // AI가 대상 폴더 밖 작업을 뺐다는 안내는 접힌 상세 보기가 아니라 카드에 바로 보인다.
  const planSummary = splitPlanSummary(plan?.summary, run?.status);
  const note = clarificationMessage
    ?? (mcpContext ? failureMessage : isEditPlan ? documentEditRunNote(run, t) : failureMessage)
    ?? (canDecide && accessVerdict !== "all_blocked"
      ? mcpContext ? t("plan.reviewBeforeApprove") : isEditPlan ? documentEditDecisionNote(documentEditRunnableCount({ selectedCount: approval?.selectedCount ?? 0, isExpired: isPreviewExpired }), t) : t("plan.reviewBeforeApprove")
      : null)
    ?? (plan && isAutoApprovedPlan(run) ? autoApprovedPlanNote(plan, t) : null);
  const messageNotice = isEditPlan ? documentEditMessageNotice(message, plan?.summary) : null;
  const previewNotice = !mcpContext && isEditPlan && canDecide
    ? editPreviewNotice({ state: editPreviews.state, missingCount: editRows.filter((row) => !row.hunks && !row.isPurged).length, isExpired: isPreviewExpired }, t)
    : null;

  useEffect(() => {
    if (!mcpSelectionKey || !onMcpSelectionChange) return;
    onMcpSelectionChange({ operationIds: selectedMcpOperationIds, priceSnapshot: mcpPriceSnapshot });
  }, [mcpPriceSnapshot, mcpSelectionKey, onMcpSelectionChange, selectedMcpOperationIds]);

  useEffect(() => { setMcpSelectionNotice(null); }, [mcpSelectionKey]);

  function toggleEditRow(rowId: string) {
    const next = new Set(deselectedIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    setUserDeselectedIds(next);
  }

  function toggleMcpOperation(operationId: string) {
    if (!plan || !mcpSelectionKey) return;
    const next = toggleMcpOperationSelection(plan, selectedMcpOperationIds, operationId);
    const changed = Math.abs(next.length - selectedMcpOperationIds.length);
    setMcpSelection({ key: mcpSelectionKey, ids: next });
    setMcpSelectionNotice(changed > 1 ? t("plan.mcpSelection.dependenciesChanged", { count: changed - 1 }) : null);
  }

  return (
    <div className={styles["task-plan"]} aria-label={isEditPlan ? t("plan.label.edit") : action === "folder_organize" ? t("plan.label.folderOrganize") : t("plan.label.workspace")}>
      {plan && <>
        {preview?.summary && <p className={styles["plan-counts"]}>{preview.summary}</p>}
        {planSummary.scopeNote && <p className={styles["task-card-meta"]} role="status">{planSummary.scopeNote}</p>}
        {mcpContext ? <>
          <details className={styles["plan-details"]} open>
            <summary>{t("plan.details")}</summary>
            {planSummary.body && <p>{planSummary.body}</p>}
            <ol>
              {operations.map((operation) => {
                const selected = selectedMcpOperationIds.includes(operation.id);
                const contentPreview = contentPreviewByOperation.get(operation.id);
                const hasValidContentPreview = contentPreview && validMcpContentPreview(operation, contentPreview);
                const contentRow = hasValidContentPreview ? {
                  id: operation.id,
                  operationIds: [operation.id],
                  title: contentPreview.display_name.normalize("NFC"),
                  summary: contentPreview.summary.trim().normalize("NFC"),
                  addedLines: contentPreview.added_lines,
                  removedLines: contentPreview.removed_lines,
                  hunks: contentPreview.hunks,
                  warning: operation.warning?.message.trim().normalize("NFC") || null,
                  resultLabel: null,
                  isFailure: false,
                  excluded: !selected,
                  isPurged: false
                } : null;
                const attemptedUnknown = operation.status === "running"
                  && (run?.mcp_settlement?.forward_status === "UNKNOWN" || run?.mcp_settlement?.settlement_status === "PENDING_RECONCILIATION");
                const existingResult = operation.existing_result;
                const reusedExisting = Boolean(["create_document", "create_folder"].includes(operation.tool_name) && existingResult
                  && ["DOCUMENT", "FOLDER"].includes(existingResult.resource_type)
                  && existingResult.resource_id?.trim()
                  && Number.isSafeInteger(existingResult.current_version)
                  && existingResult.current_version > 0);
                return <li key={operation.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t("plan.mcpSelection.operationCheckbox", { operation: operation.description })}
                      checked={selected}
                      disabled={!canDecide}
                      onChange={() => toggleMcpOperation(operation.id)}
                    />
                    <strong>{operation.description}</strong>
                  </label>
                  {operation.reason && <p>{operation.reason.normalize("NFC")}</p>}
                  {operation.warning?.message?.trim() && <p className={styles["plan-operation-blocked"]}>{operation.warning.message.trim().normalize("NFC")}</p>}
                  {operation.depends_on && operation.depends_on.length > 0 && <p>{t("plan.mcpSelection.requires", { count: operation.depends_on.length })}</p>}
                  {access?.blockedOperationIds.has(operation.id) && <p className={styles["plan-operation-blocked"]}>{t("plan.access.operationBlocked")}</p>}
                  {!PENDING_OPERATION_STATUSES.has(operation.status) && <small>{planOperationResultLabel(operation, t)}</small>}
                  {planOperationOutcome(operation) === "failed" && <p className={styles["plan-operation-blocked"]}>{planOperationFailureReason(operation, t)}</p>}
                  {attemptedUnknown && <p className={styles["plan-operation-blocked"]}>{t("plan.mcpResult.attemptedUnknown")}</p>}
                  {operation.error_code === "react_tool_budget_insufficient" && <p className={styles["plan-operation-blocked"]}>{t("plan.mcpResult.budgetUnstarted")}</p>}
                  {operation.error_code === "mcp_create_pending_reconciliation" && <p className={styles["plan-operation-blocked"]}>{t("plan.mcpResult.createHeld")}</p>}
                  {reusedExisting && <p className={styles["task-card-meta"]}>{t("plan.mcpResult.existingReused")}</p>}
                  {contentRow && <details className={styles["edit-plan-doc"]} open={selected}>
                    <summary>{t(operation.tool_name === "create_document" ? "plan.mcpSelection.createPreview" : "plan.mcpSelection.editPreview")}</summary>
                    <DocumentEditDiff row={contentRow} missingNote={t("plan.mcpSelection.previewMissing")} />
                  </details>}
                </li>;
              })}
            </ol>
          </details>
        </> : isEditPlan ? <>
          {messageNotice && <p className={styles["task-card-meta"]} role="status">{messageNotice}</p>}
          <DocumentEditPlanPreview
            rows={editRows}
            deselectedIds={deselectedIds}
            canSelect={!mcpContext && canDecide && !isPreviewExpired}
            isAwaiting={canDecide}
            isLoadingPreviews={editPreviews.state === "loading"}
            isPreviewExpired={isPreviewExpired}
            blockedOperationIds={editBlockedOperationIds}
            blockedRowIds={blockedRowIds}
            onToggle={toggleEditRow}
          />
        </> : <>
          <div className={styles["plan-tree-region"]} aria-label={t("plan.tree.label")}>
            <PlanTree nodes={preview?.nodes ?? []} />
          </div>
          <details className={styles["plan-details"]}>
            <summary>{t("plan.details")}</summary>
            {planSummary.body && <p>{planSummary.body}</p>}
            <ol>
              {operations.map((operation) => (
                <li key={operation.id}>
                  <strong>{operation.description}</strong>
                  {operation.reason && <p>{operation.reason.normalize("NFC")}</p>}
                  {access?.blockedOperationIds.has(operation.id) && <p className={styles["plan-operation-blocked"]}>{t("plan.access.operationBlocked")}</p>}
                  {!PENDING_OPERATION_STATUSES.has(operation.status) && <small>{planOperationResultLabel(operation, t)}</small>}
                  {planOperationOutcome(operation) === "failed" && <p className={styles["plan-operation-blocked"]}>{planOperationFailureReason(operation, t)}</p>}
                </li>
              ))}
            </ol>
          </details>
        </>}
      </>}
      {note && <p className={styles["task-note"]} role={isFailed ? "alert" : undefined}>{note}</p>}
      {error && <p className={styles["task-error"]} role="alert">{typeof error === "string" ? error : errorMessage?.(error) ?? agentChatErrorMessage(error, t("plan.loadFailed"), t, tShared)}</p>}
      {canDecide && approvalDisabledReason && <p className={styles["task-error"]} role="alert">{approvalDisabledReason}</p>}
      {canDecide && mcpContext && !mcpSelectionValid && <p className={styles["task-error"]} role="alert">{t("plan.mcpSelection.selectOne")}</p>}
      {canDecide && mcpContext && selectedMcpContentOperations.length > 0 && (isPreviewExpired || editPreviews.state === "error" || (editPreviews.state === "ready" && missingMcpContentPreviews.length > 0)) && <p className={styles["task-error"]} role="alert">{t("plan.mcpSelection.previewMissing")}</p>}
      {mcpSelectionNotice && <p className={styles["task-card-meta"]} role="status">{mcpSelectionNotice}</p>}
      {previewNotice && <p className={styles["task-card-meta"]} role="status">{previewNotice}</p>}
      {editPreviews.canRetry && canDecide && (
        <div className={styles["task-actions"]}>
          <button type="button" className={styles["task-pill"]} disabled={busy} onClick={editPreviews.refetch}>{t("editPlan.reloadChanges")}</button>
        </div>
      )}
      {plan && onOpenPreview && !isEditPlan && (
        <div className={styles["task-actions"]}>
          <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onOpenPreview}>
            <AgentAssetIcon src={taskBoltIcon} size={12} />
            {t("plan.openPreview")}
          </button>
        </div>
      )}
      {canDecide && approvalHint && <p className={cx(styles["task-card-meta"], styles["task-decision-hint"])} role="status">{approvalHint}</p>}
      {accessMessage && <p className={cx(styles["task-card-meta"], styles["task-decision-hint"])} role="status">{accessMessage}</p>}
      {canRetry && !canDecide && (
        <div className={styles["task-actions"]}>
          <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} onClick={onRetry}>
            <AgentAssetIcon src={taskBoltIcon} size={12} />
            {t("actions.tryAgain")}
          </button>
        </div>
      )}
      {(canDecide || (error && turnId)) && (
        // 거절·수락 (Figma 1671:13230): 오른쪽 정렬, 빨강·주 색 바탕
        <div className={styles["task-decisions"]}>
          {error && turnId && (
            <button type="button" className={styles["task-pill"]} disabled={busy} onClick={() => { mutation.reset(); onRefetch(); void tree.refetch(); }}>
              {t("actions.checkAgain")}
            </button>
          )}
          {canDecide && <>
            <button type="button" className={cx(styles["task-decision"], styles["is-danger"])} disabled={busy || Boolean(runError)} onClick={() => mutation.mutate({ decision: "reject" })}>
              <AgentAssetIcon src={taskRejectIcon} size={12} />
              {t("actions.reject")}
            </button>
            <button
              type="button"
              className={styles["task-decision"]}
              aria-label={isEditPlan ? t("plan.acceptLabel.edit") : action === "folder_organize" ? t("plan.acceptLabel.folderOrganize") : t("plan.acceptLabel.workspace")}
              disabled={!ready || busy}
              title={accessVerdict === "all_blocked" ? accessMessage ?? undefined : previewNotice ?? undefined}
              onClick={() => mutation.mutate({ decision: "approve", operationIds: approvalOperationIds })}
            >
              <AgentAssetIcon src={taskAcceptIcon} size={12} />
              {mutation.isPending ? t("actions.processing") : t("actions.accept")}
            </button>
          </>}
        </div>
      )}
    </div>
  );
}
