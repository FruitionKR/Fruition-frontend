import { analyticsEditType, newAnalyticsId } from "@/shared/lib/analytics/events";
import { captureAnalytics } from "@/shared/lib/analytics/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RunStageEvent } from "@/shared/lib/runEventStream";
import type { AiModel } from "@/entities/ai";
import { requestAgentTurn, resumeAgentTurn } from "@/features/agent-chat";
import {
  buildAgentTurnRequest,
  prepareMarkdownEditPreview,
  resolveChatTurnPresentation,
  resolveGeneratedDocumentFolderId,
  validateMarkdownEditApplication
} from "@/features/agent-chat/lib/agentTurn";
import type { AgentTurnRequest, AgentTurnResponse, GeneratedMarkdownDraft, MarkdownEditPreview as MarkdownEditPreviewData } from "@/features/agent-chat/lib/agentTurn";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import { isContentEditAutoApproved, resolveTurnAutoApply } from "@/features/agent-chat/lib/autoApply";
import { shouldRestoreAttachments } from "../lib/composerDocuments";
import { AGENT_AUTO_APPROVAL_QUERY_KEY } from "@/features/user-settings/lib/agentAutoApproval";
import { useAgentAutoApprovalSettings } from "@/features/user-settings/model/useAgentAutoApprovalSettings";
import {
  buildEditReviewSegments,
  composeReviewedMarkdown,
  countPendingProposals,
  countProposals,
  hasAcceptedProposal,
  settleRemainingProposals,
  type EditProposalDecision,
  type EditProposalDecisions,
  type EditReviewSegment
} from "@/features/agent-chat/lib/inlineEditReview";
import {
  browserTaskOutcomeStorage,
  mergeTaskOutcomes,
  readTaskOutcomes,
  recordTaskOutcome,
  taskOutcomeStorageKey,
  turnIdsWithOutcome,
  writeTaskOutcome,
  type TaskOutcome,
  type TaskOutcomes
} from "@/features/agent-chat/lib/taskOutcomes";
import {
  readOnlyRequestStorageKey,
  readReadOnlyRequests,
  recordReadOnlyRequest,
  writeReadOnlyRequest,
  type ReadOnlyRequests
} from "@/features/agent-chat/lib/readOnlyRequests";
import { getErrorMessage, isInsufficientCreditError } from "@/shared/lib/apiErrors";
import { AgentTurnLostError } from "@/features/agent-chat/lib/turnFollow";
import { agentTurnFailure, createAiTaskFailureReporter, markdownCreateFailure } from "@/features/agent-chat/lib/aiTaskFailure";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

const NO_DECISIONS: EditProposalDecisions = {};

/**
 * 작업 탭 요청(agent turn, mode=task): 요청·진행 단계·응답과
 * 그 결과로 보여 주는 편집 미리보기·적용·새 Markdown 문서 만들기.
 * 열린 문서가 없거나 대상에서 빼면 문서 없이 보낸다(폴더 정리·폴더 스킬).
 */
export function useAgentTurn({
  markdownEditContext,
  readOnlyDocumentId,
  activeSessionId,
  selectedModel,
  selectedPairIds,
  allowWebSearch,
  refreshMessages,
  onCreateMarkdownDocument,
  onInsufficientCredit,
  onReferencesRestored
}: {
  markdownEditContext: ActiveMarkdownEditContext | null | undefined;
  /** 지금 열린 보기 권한 문서. 요청을 보낼 때의 값을 turn과 묶어 기억한다. */
  readOnlyDocumentId: string | null;
  activeSessionId: string | null;
  selectedModel: AiModel | null;
  selectedPairIds: string[];
  allowWebSearch: boolean;
  /** 응답이 오면 대화 목록을 다시 받아 새 문답을 이어 붙인다. */
  refreshMessages: (options: { animateLatest: boolean }) => Promise<unknown>;
  /** folderId는 새 문서를 둘 폴더(null이면 루트). agentRunId는 작업 탭 초안(markdown_create)을 만든 run ID다. */
  onCreateMarkdownDocument: (draft: GeneratedMarkdownDraft, folderId: string | null, agentRunId: string | null) => Promise<void>;
  /** 크레딧 부족(402)으로 거절된 질문. 충전 뒤 다시 보낼 수 있게 입력을 되돌리는 데 쓴다(#153). */
  onInsufficientCredit?: (question: string) => void;
  /** 첨부를 실은 요청이 시작되지 못했다. 다시 고르거나 보낼 수 있게 입력과 첨부를 되돌리는 데 쓴다. */
  onReferencesRestored?: (question: string, referenceDocumentIds: string[]) => void;
}) {
  const [agentTurnResponse, setAgentTurnResponse] = useState<AgentTurnResponse | null>(null);
  const [agentTurnRequest, setAgentTurnRequest] = useState<AgentTurnRequest | null>(null);
  const [agentTurnErrorMessage, setAgentTurnErrorMessage] = useState<string | null>(null);
  const [isAgentTurnLoading, setIsAgentTurnLoading] = useState(false);
  const [agentStages, setAgentStages] = useState<RunStageEvent[]>([]);
  // 진행 연결이 끊겨 turn 조회로 끝을 확인하는 중인지. 진행 카드에 기다림 안내를 띄운다.
  const [isAgentTurnSlow, setIsAgentTurnSlow] = useState(false);
  // 결과 확인이 끊긴 turn. '다시 확인'으로 같은 turn의 끝을 이어서 확인한다.
  const [unconfirmedTurnId, setUnconfirmedTurnId] = useState<string | null>(null);
  // 지금 보낸 요청(agentTurnRequest)을 서버가 받아 정한 turn ID. 따라가는 동안 진행 카드와 서버 기록을 같은 turn으로 묶는다.
  const [requestTurnId, setRequestTurnId] = useState<string | null>(null);
  const agentRequestRef = useRef<AbortController | null>(null);
  useEffect(() => () => agentRequestRef.current?.abort(), []);
  // 서버가 모르는 실패(응답 없음 확정·서버에 닿지 않은 요청)만 보낸다. 같은 turn은 한 번만.
  const reportAiTaskFailure = useRef(createAiTaskFailureReporter((properties) => captureAnalytics("ai_task_failed", properties))).current;
  const [isCreatingMarkdown, setIsCreatingMarkdown] = useState(false);
  const [markdownCreateErrorMessage, setMarkdownCreateErrorMessage] = useState<string | null>(null);
  // 이 화면에서 작업 탭으로 보낸 turn ID. 서버가 채팅 답변으로 돌려줘도 작업 탭에 남긴다.
  const [taskRunIds, setTaskRunIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    // 다른 작업 대화의 제안·오류를 새 세션의 기록 위에 표시하지 않는다.
    // 이전 통합 기록에서 새 세션으로 첫 요청을 보낸 직후에는 그 요청을 유지한다.
    if (agentTurnRequest && agentTurnRequest.session_id !== activeSessionId && !isAgentTurnLoading) {
      setAgentTurnRequest(null);
      setAgentTurnResponse(null);
      setAgentTurnErrorMessage(null);
      setMarkdownCreateErrorMessage(null);
      setRequestTurnId(null);
      setUnconfirmedTurnId(null);
    }
  }, [activeSessionId, agentTurnRequest, isAgentTurnLoading]);
  // 편집안을 적용·새 문서로 만들었거나(저장됨) 모두 거절했거나(거절됨, Figma 1610:9421) 초안을 취소한(취소됨) turn.
  // 새로 고침 뒤에도 남게 워크스페이스·세션별 localStorage에 적어 두고, 세션을 열 때 읽어 합친다.
  const [taskOutcomes, setTaskOutcomes] = useState<TaskOutcomes>(() => new Map());
  const outcomeStorageKey = useMemo(() => {
    const workspaceId = getSelectedWorkspaceId();
    return workspaceId && activeSessionId ? taskOutcomeStorageKey(workspaceId, activeSessionId) : null;
  }, [activeSessionId]);
  useEffect(() => {
    if (!outcomeStorageKey) return;
    const stored = readTaskOutcomes(browserTaskOutcomeStorage(), outcomeStorageKey);
    if (stored.size > 0) setTaskOutcomes((current) => mergeTaskOutcomes(stored, current));
  }, [outcomeStorageKey]);
  const markOutcome = useCallback((turnId: string | undefined, outcome: TaskOutcome) => {
    if (!turnId) return;
    setTaskOutcomes((current) => recordTaskOutcome(current, turnId, outcome));
    if (outcomeStorageKey) writeTaskOutcome(browserTaskOutcomeStorage(), outcomeStorageKey, turnId, outcome);
  }, [outcomeStorageKey]);
  const markApplied = useCallback((turnId: string | undefined) => markOutcome(turnId, "applied"), [markOutcome]);
  const autoAppliedTurnIds = useMemo(() => turnIdsWithOutcome(taskOutcomes, "auto_applied"), [taskOutcomes]);
  const appliedTurnIds = useMemo(
    () => new Set([...turnIdsWithOutcome(taskOutcomes, "applied"), ...autoAppliedTurnIds]),
    [autoAppliedTurnIds, taskOutcomes]
  );
  // 보기 권한 문서를 연 채 보낸 turn과 그 문서. 서버 값이 없는 메시지(구 서버·과거 메시지)의 되묻기를 판단할 때 쓴다.
  const [readOnlyRequests, setReadOnlyRequests] = useState<ReadOnlyRequests>(() => new Map());
  useEffect(() => {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId) return;
    const stored = readReadOnlyRequests(browserTaskOutcomeStorage(), readOnlyRequestStorageKey(workspaceId));
    setReadOnlyRequests((current) => new Map([...stored, ...current]));
  }, [activeSessionId]);
  // submitAgentTurn은 세션마다 만들지 않으므로 보낼 때의 값을 ref로 읽는다.
  const readOnlyDocumentIdRef = useRef(readOnlyDocumentId);
  readOnlyDocumentIdRef.current = readOnlyDocumentId;
  const rememberReadOnlyRequest = useCallback((turnId: string, documentId: string | null) => {
    if (!documentId) return;
    setReadOnlyRequests((current) => recordReadOnlyRequest(current, turnId, documentId));
    const workspaceId = getSelectedWorkspaceId();
    if (workspaceId) writeReadOnlyRequest(browserTaskOutcomeStorage(), readOnlyRequestStorageKey(workspaceId), turnId, documentId);
  }, []);
  const rejectedTurnIds = useMemo(() => turnIdsWithOutcome(taskOutcomes, "rejected"), [taskOutcomes]);
  const cancelledTurnIds = useMemo(() => turnIdsWithOutcome(taskOutcomes, "cancelled"), [taskOutcomes]);
  // 본문에 붙인 제안(Figma 1571:27625)마다 고른 거절·수락. 다른 turn의 결정은 쓰지 않는다.
  const [reviewDecisions, setReviewDecisions] = useState<{ turnId: string; decisions: EditProposalDecisions } | null>(null);

  const editPreviewState = useMemo<{
    preview: MarkdownEditPreviewData | null;
    validationError: string | null;
  } | null>(() => {
    if (!agentTurnRequest || !agentTurnResponse || agentTurnResponse.result.action !== "markdown_edit") return null;
    try {
      const preview = prepareMarkdownEditPreview(agentTurnRequest, agentTurnResponse);
      if (!markdownEditContext) {
        return { preview, validationError: "편집 중인 문서를 다시 열고 재생성해주세요." };
      }
      try {
        validateMarkdownEditApplication(agentTurnRequest, agentTurnResponse, markdownEditContext);
        return { preview, validationError: null };
      } catch (error) {
        return { preview, validationError: getErrorMessage(error, "편집 결과를 적용할 수 없습니다.") };
      }
    } catch (error) {
      return { preview: null, validationError: getErrorMessage(error, "편집 응답 계약이 올바르지 않습니다.") };
    }
  }, [agentTurnRequest, agentTurnResponse, markdownEditContext]);
  const reviewSegments = useMemo<EditReviewSegment[] | null>(() => {
    const edit = agentTurnResponse?.result.edit;
    const sourceMarkdown = agentTurnRequest?.editorSnapshot?.markdown;
    if (!editPreviewState?.preview || !edit || sourceMarkdown === undefined) return null;
    return buildEditReviewSegments(sourceMarkdown, edit);
  }, [agentTurnRequest, agentTurnResponse, editPreviewState]);
  const activeTurnId = agentTurnResponse?.requestId;
  const proposalDecisions = useMemo<EditProposalDecisions>(
    () => (reviewDecisions && reviewDecisions.turnId === activeTurnId ? reviewDecisions.decisions : NO_DECISIONS),
    [activeTurnId, reviewDecisions]
  );
  const editPreviewErrorMessage = editPreviewState && !editPreviewState.preview
    ? `${editPreviewState.validationError ?? "편집 결과를 적용할 수 없습니다."} 원문은 변경되지 않았습니다. 최신 문서에서 다시 요청해주세요.`
    : null;

  const queryClient = useQueryClient();
  const autoApprovalSettings = useAgentAutoApprovalSettings();
  const isAutoApproved = isContentEditAutoApproved(autoApprovalSettings);
  // 자동 처리 판단을 끝낸 turn. 응답마다 한 번만 판단하고, 수동으로 넘긴 뒤에는 설정이 늦게 도착해도 바꾸지 않는다.
  const autoDecidedTurnIdsRef = useRef(new Set<string>());
  // 수락 화면으로 넘긴 turn. 자동 적용에 실패한 turn도 여기 들어가 다시 시도하지 않는다.
  const [manualTurnIds, setManualTurnIds] = useState<ReadonlySet<string>>(() => new Set());
  // 사용자가 Esc로 멈추려 한 turn. 이미 끝나 결과가 와도 확인 없이 반영하지 않는다.
  const stoppedTurnIdsRef = useRef(new Set<string>());
  const responseTurnId = agentTurnResponse?.requestId ?? null;
  const autoApplyKind = resolveTurnAutoApply({
    action: agentTurnResponse?.result.action,
    isContentEditAutoApproved: isAutoApproved,
    isAlreadyHandled: responseTurnId === null || manualTurnIds.has(responseTurnId) || appliedTurnIds.has(responseTurnId),
    isManualOnly: responseTurnId !== null && stoppedTurnIdsRef.current.has(responseTurnId),
    isFromActiveSession: agentTurnRequest?.session_id === activeSessionId,
    hasEditPreview: Boolean(editPreviewState?.preview),
    hasApplyOperationId: Boolean(agentTurnResponse?.apply_operation_id),
    validationError: editPreviewState?.validationError ?? null,
    isDocumentWritable: markdownEditContext?.isWritable === true,
    proposalCount: reviewSegments ? countProposals(reviewSegments) : 0,
    isScopeExpanded: agentTurnResponse?.result.edit?.scope_expanded === true,
    draft: agentTurnResponse?.result.generated_markdown ?? null
  });

  /**
   * turn의 끝을 기다린 뒤 대화 목록을 다시 받아 결과를 보여 준다. 결과를 확인하지 못한 채 끝나면(조회 실패·연결 끊김)
   * 그 turn을 남겨 '다시 확인'으로 이어서 확인할 수 있게 한다.
   */
  function followTurnResult(
    controller: AbortController,
    question: string,
    run: () => Promise<AgentTurnResponse>,
    getTurnId: () => string | null,
    clientTaskId: string,
    referenceDocumentIds: string[] = []
  ) {
    run()
      .then(async (response) => {
        if (controller.signal.aborted) return;
        // turn은 이미 끝났다. 목록을 다시 받지 못해도 실패로 돌리지 않고 결과(편집 미리보기·새 문서 초안)는 보여 준다.
        await refreshMessages({ animateLatest: true }).catch(() => undefined);
        if (controller.signal.aborted) return;
        setAgentTurnResponse(
          resolveChatTurnPresentation(response.result.action).kind === "document-command" ? response : null
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAgentTurnErrorMessage(getErrorMessage(error, "작업 요청에 실패했습니다."));
        if (isInsufficientCreditError(error)) onInsufficientCredit?.(question);
        const turnId = getTurnId();
        if (shouldRestoreAttachments(error, { referenceDocumentIds, turnId })) onReferencesRestored?.(question, referenceDocumentIds);
        reportAiTaskFailure(agentTurnFailure(error, { turnId, clientTaskId }));
        if (!turnId) return;
        if (error instanceof AgentTurnLostError) setUnconfirmedTurnId(turnId);
        // 결과를 확인하지 못했으면 서버에 남은 진행 기록(진행 중 카드)이, 실패로 끝났으면 그 turn이
        // 작업 탭 '실패' 묶음에 보이도록 목록을 다시 받는다.
        void refreshMessages({ animateLatest: false }).catch(() => undefined);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsAgentTurnLoading(false);
        setIsAgentTurnSlow(false);
      });
  }

  /** 결과 확인이 끊긴 turn의 끝을 다시 확인한다. 진행 SSE 없이 turn 조회로만 따라간다. */
  function recheckAgentTurn() {
    const turnId = unconfirmedTurnId;
    if (!turnId || isAgentTurnLoading) return;
    resumeFollowing(turnId);
  }

  /** 같은 turn의 끝을 turn 조회로 다시 따라간다(다시 확인·중지 요청이 409로 끝났거나 전해지지 않았을 때). */
  function resumeFollowing(turnId: string) {
    setUnconfirmedTurnId(null);
    setAgentTurnErrorMessage(null);
    setIsAgentTurnLoading(true);
    setIsAgentTurnSlow(true);
    // 끊긴 동안 다른 기기에서 끈 자동 승인이 이 결과에 쓰이지 않게 다시 받는다. 응답이 먼저 오면 조회 중이라 수락 화면으로 간다.
    void queryClient.invalidateQueries({ queryKey: AGENT_AUTO_APPROVAL_QUERY_KEY });
    agentRequestRef.current?.abort();
    const controller = new AbortController();
    agentRequestRef.current = controller;
    followTurnResult(
      controller,
      agentTurnRequest?.message ?? "",
      () => resumeAgentTurn(turnId, { signal: controller.signal }),
      () => turnId,
      turnId
    );
  }

  const submitAgentTurn = useCallback((
    question: string,
    context: ActiveMarkdownEditContext | null,
    sessionId: string,
    model: AiModel,
    conversationPairIds: string[],
    /** 폴더를 대상으로 고른 스킬 실행이면 그 폴더. */
    folderId: string | null = null,
    /** 근거로 첨부한 문서. */
    referenceDocumentIds: string[] = []
  ) => {
    const requestReadOnlyDocumentId = readOnlyDocumentIdRef.current;
    const request = buildAgentTurnRequest(question, context, {
      readOnlyDocumentId: requestReadOnlyDocumentId,
      sessionId,
      selectedModel: { provider: model.provider, model: model.model },
      selectedPairIds: conversationPairIds,
      allowWebSearch,
      folderId,
      referenceDocumentIds
    });
    setAgentTurnRequest(request);
    setAgentTurnResponse(null);
    setAgentTurnErrorMessage(null);
    setMarkdownCreateErrorMessage(null);
    setIsAgentTurnLoading(true);
    setAgentStages([]);
    setIsAgentTurnSlow(false);
    setUnconfirmedTurnId(null);
    setRequestTurnId(null);
    // 다른 기기에서 끈 자동 승인이 이번 결과에 쓰이지 않게 보낼 때마다 다시 받는다.
    void queryClient.invalidateQueries({ queryKey: AGENT_AUTO_APPROVAL_QUERY_KEY });
    agentRequestRef.current?.abort();
    const controller = new AbortController();
    agentRequestRef.current = controller;
    let acceptedTurnId: string | null = null;
    followTurnResult(controller, question, () => requestAgentTurn(request, {
      signal: controller.signal,
      onAccepted: (requestId) => {
        acceptedTurnId = requestId;
        rememberReadOnlyRequest(requestId, requestReadOnlyDocumentId);
        if (controller.signal.aborted) return;
        setRequestTurnId(requestId);
        setTaskRunIds((current) => new Set([...current, requestId]));
      },
      onStage: (stage) => {
        if (!controller.signal.aborted) setAgentStages((current) => [...current, stage]);
      },
      onSlow: () => { if (!controller.signal.aborted) setIsAgentTurnSlow(true); }
    }), () => acceptedTurnId, newAnalyticsId(), referenceDocumentIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowWebSearch, refreshMessages, onInsufficientCredit, onReferencesRestored, rememberReadOnlyRequest]);

  /**
   * 지금 따라가는 turn의 진행 SSE·조회를 멈춘다(Esc 중지). 서버 취소는 호출부가 요청하고, 결과를 받을 때까지
   * 진행 카드는 그대로 둔다. 취소가 받아들여지면 finishFollowing으로 진행 카드를 내린다.
   */
  function stopFollowing() {
    if (requestTurnId) stoppedTurnIdsRef.current.add(requestTurnId);
    agentRequestRef.current?.abort();
    agentRequestRef.current = null;
  }

  function finishFollowing() {
    setIsAgentTurnLoading(false);
    setIsAgentTurnSlow(false);
  }

  /** 응답을 받지 못한 turn을 닫았다. 그 turn의 '결과 다시 확인'·오류 안내를 지운다. */
  function forgetTurn(turnId: string) {
    if (unconfirmedTurnId !== turnId) return;
    setUnconfirmedTurnId(null);
    setAgentTurnErrorMessage(null);
  }

  function dismissAgentTurnResult() {
    setAgentTurnRequest(null);
    setAgentTurnResponse(null);
    setAgentTurnErrorMessage(null);
    setMarkdownCreateErrorMessage(null);
  }

  /** 편집안·새 문서 초안 카드의 '취소'. 작업 목록에서 "취소됨"으로 남긴다. */
  function cancelAgentTurnResult() {
    markOutcome(agentTurnResponse?.requestId, "cancelled");
    dismissAgentTurnResult();
  }

  function regenerateAgentTurn() {
    const needsDocument = agentTurnRequest?.documentId !== undefined;
    if (!agentTurnRequest || (needsDocument && !markdownEditContext) || !activeSessionId || !selectedModel) {
      setAgentTurnErrorMessage("편집 중인 문서를 다시 열고 재생성해주세요.");
      return;
    }
    submitAgentTurn(agentTurnRequest.message, needsDocument ? markdownEditContext ?? null : null, activeSessionId, selectedModel, selectedPairIds, agentTurnRequest.folder_id ?? null, agentTurnRequest.reference_document_ids);
  }

  function applyMarkdownEdit() {
    if (editPreviewState?.preview) applyEditedMarkdown(editPreviewState.preview.nextMarkdown);
  }

  /** 적용했으면 true. 실패하면 원문을 그대로 두고 오류를 보여 준다. */
  function applyEditedMarkdown(nextMarkdown: string, outcome: "applied" | "auto_applied" = "applied"): boolean {
    if (!agentTurnRequest || !agentTurnResponse || !markdownEditContext || !editPreviewState?.preview) return false;
    try {
      validateMarkdownEditApplication(agentTurnRequest, agentTurnResponse, markdownEditContext);
      if (!markdownEditContext.isWritable) throw new Error("지금은 이 문서를 저장할 수 없어 편집안을 적용하지 않았습니다. 편집 권한과 로그인 상태를 확인해 주세요.");
      const applied = markdownEditContext.applyMarkdown(
        agentTurnRequest.editorSnapshot?.markdown ?? "",
        nextMarkdown,
        agentTurnResponse.apply_operation_id
      );
      if (!applied) throw new Error("적용 직전에 문서가 변경되었습니다. 최신 내용으로 재생성해주세요.");
      markOutcome(agentTurnResponse.requestId, outcome);
      setAgentTurnRequest(null);
      setAgentTurnResponse(null);
      setAgentTurnErrorMessage(null);
      return true;
    } catch (error) {
      setAgentTurnErrorMessage(getErrorMessage(error, "편집 결과를 적용하지 못했습니다."));
      return false;
    }
  }

  /** 모든 제안을 정했으면 수락한 제안만 한 번에 적용한다. 하나도 수락하지 않았으면 거절로 닫는다. */
  function settleProposals(decisions: EditProposalDecisions) {
    const turnId = agentTurnResponse?.requestId;
    if (!reviewSegments || !turnId) return;
    if (countPendingProposals(reviewSegments, decisions) > 0) {
      setReviewDecisions({ turnId, decisions });
      return;
    }
    if (!hasAcceptedProposal(decisions)) {
      if (agentTurnResponse) captureAnalytics("ai_edit_decided", { proposal_id: turnId, document_id: agentTurnResponse.documentId, edit_type: analyticsEditType(agentTurnResponse.result.edit), decision: "rejected" });
      markOutcome(turnId, "rejected");
      setReviewDecisions(null);
      dismissAgentTurnResult();
      return;
    }
    setReviewDecisions({ turnId, decisions });
    applyEditedMarkdown(composeReviewedMarkdown(reviewSegments, decisions));
  }

  /** 본문 제안 하나의 거절·수락(Figma 1610:2831). */
  function decideProposal(index: number, decision: EditProposalDecision) {
    settleProposals({ ...proposalDecisions, [index]: decision });
  }

  /** 작업 탭 카드의 거절·수락. 아직 정하지 않은 제안을 모두 같은 결정으로 채운다. */
  function decideRemainingProposals(decision: EditProposalDecision) {
    if (!reviewSegments) return;
    settleProposals(settleRemainingProposals(reviewSegments, proposalDecisions, decision));
  }

  /** "더 짧게"처럼 같은 요청에 지시를 덧붙여 다시 받는다(Figma 1610:9183). */
  function refineAgentTurn(instruction: string) {
    if (!agentTurnRequest || !markdownEditContext || !activeSessionId || !selectedModel) return;
    submitAgentTurn(`${agentTurnRequest.message}\n${instruction}`, markdownEditContext, activeSessionId, selectedModel, selectedPairIds, agentTurnRequest.folder_id ?? null, agentTurnRequest.reference_document_ids);
  }

  function openMarkdownEditAsNewDocument() {
    if (!editPreviewState?.preview) return;
    const preview = editPreviewState.preview;
    const draft: GeneratedMarkdownDraft = {
      title: preview.summary.trim() || "AI 편집안",
      summary: preview.summary,
      markdown: preview.nextMarkdown
    };
    setIsCreatingMarkdown(true);
    setAgentTurnErrorMessage(null);
    // 편집 turn(markdown_edit)은 서버가 AI 초안으로 보지 않으므로 run ID를 넘기지 않는다.
    onCreateMarkdownDocument(draft, resolveGeneratedDocumentFolderId(agentTurnResponse), null)
      .then(() => {
        markApplied(agentTurnResponse?.requestId);
        setAgentTurnRequest(null);
        setAgentTurnResponse(null);
      })
      .catch((error: unknown) => {
        setAgentTurnErrorMessage(getErrorMessage(error, "편집안을 새 Markdown 문서로 만들지 못했습니다."));
      })
      .finally(() => setIsCreatingMarkdown(false));
  }

  function createMarkdownDocument(outcome: "applied" | "auto_applied" = "applied") {
    const draft = agentTurnResponse?.result.generated_markdown;
    if (!draft) return;
    const runId = agentTurnResponse.requestId;
    setIsCreatingMarkdown(true);
    setMarkdownCreateErrorMessage(null);
    onCreateMarkdownDocument(draft, resolveGeneratedDocumentFolderId(agentTurnResponse), runId)
      .then(() => {
        markOutcome(runId, outcome);
        setAgentTurnRequest(null);
        setAgentTurnResponse(null);
      })
      .catch((error: unknown) => {
        reportAiTaskFailure(markdownCreateFailure(error, runId));
        setMarkdownCreateErrorMessage(getErrorMessage(error, "새 Markdown 문서를 만들지 못했습니다."));
        // 자동 재시도하지 않고 오류와 함께 기존 화면으로 돌아간다.
        setManualTurnIds((current) => new Set([...current, runId]));
      })
      .finally(() => setIsCreatingMarkdown(false));
  }

  // 편집안·초안이 도착하면 한 번만 판단한다. 응답을 받은 직후 렌더에서는 아직 요청 중으로 남아 있을 수 있어 끝나길 기다린다.
  const applyAutoRef = useRef<(kind: "edit" | "create") => void>(() => {});
  applyAutoRef.current = (kind) => {
    if (kind === "create") {
      createMarkdownDocument("auto_applied");
      return;
    }
    if (!editPreviewState?.preview || applyEditedMarkdown(editPreviewState.preview.nextMarkdown, "auto_applied")) return;
    if (responseTurnId) setManualTurnIds((current) => new Set([...current, responseTurnId]));
  };
  const isCommandResponse = agentTurnResponse?.result.action === "markdown_edit" || agentTurnResponse?.result.action === "markdown_create";
  useEffect(() => {
    if (!responseTurnId || !isCommandResponse || isAgentTurnLoading || autoDecidedTurnIdsRef.current.has(responseTurnId)) return;
    autoDecidedTurnIdsRef.current.add(responseTurnId);
    if (autoApplyKind) applyAutoRef.current(autoApplyKind);
    else setManualTurnIds((current) => new Set([...current, responseTurnId]));
  }, [autoApplyKind, isAgentTurnLoading, isCommandResponse, responseTurnId]);

  return {
    agentTurnRequest,
    agentTurnResponse,
    agentTurnErrorMessage,
    isAgentTurnLoading,
    isAgentTurnSlow,
    agentStages,
    canRecheckAgentTurn: unconfirmedTurnId !== null && !isAgentTurnLoading,
    unconfirmedTurnId,
    requestTurnId,
    /** 지금 따라가고 있는 turn. 오래 머문 turn 확인에서 뺀다. */
    followingTurnId: isAgentTurnLoading ? requestTurnId : null,
    forgetTurn,
    recheckAgentTurn,
    stopFollowing,
    finishFollowing,
    resumeFollowing,
    isCreatingMarkdown,
    markdownCreateErrorMessage,
    editPreviewState,
    editPreviewErrorMessage,
    taskRunIds,
    /** 편집안·초안을 자동으로 처리하는 중이라 수락 화면을 띄우지 않는다. */
    isAutoApplying: autoApplyKind !== null,
    appliedTurnIds,
    autoAppliedTurnIds,
    readOnlyRequests,
    rejectedTurnIds,
    cancelledTurnIds,
    reviewSegments,
    proposalDecisions,
    decideProposal,
    decideRemainingProposals,
    refineAgentTurn,
    submitAgentTurn,
    dismissAgentTurnResult,
    cancelAgentTurnResult,
    regenerateAgentTurn,
    applyMarkdownEdit,
    openMarkdownEditAsNewDocument,
    createMarkdownDocument
  };
}
