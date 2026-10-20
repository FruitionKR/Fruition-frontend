import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  buildEditReviewSegments,
  composeReviewedMarkdown,
  countPendingProposals,
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
import { getErrorMessage, isInsufficientCreditError } from "@/shared/lib/apiErrors";
import { AgentTurnLostError } from "@/features/agent-chat/lib/turnFollow";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";

const NO_DECISIONS: EditProposalDecisions = {};

/**
 * 작업 탭 요청(agent turn, mode=task): 요청·진행 단계·응답과
 * 그 결과로 보여 주는 편집 미리보기·적용·새 Markdown 문서 만들기.
 * 열린 문서가 없거나 대상에서 빼면 문서 없이 보낸다(폴더 정리·폴더 스킬).
 */
export function useAgentTurn({
  markdownEditContext,
  activeSessionId,
  selectedModel,
  selectedPairIds,
  allowWebSearch,
  refreshMessages,
  onCreateMarkdownDocument,
  onInsufficientCredit
}: {
  markdownEditContext: ActiveMarkdownEditContext | null | undefined;
  activeSessionId: string | null;
  selectedModel: AiModel | null;
  selectedPairIds: string[];
  allowWebSearch: boolean;
  /** 응답이 오면 대화 목록을 다시 받아 새 문답을 이어 붙인다. */
  refreshMessages: (options: { animateLatest: boolean }) => Promise<unknown>;
  /** folderId는 새 문서를 둘 폴더(null이면 루트). */
  onCreateMarkdownDocument: (draft: GeneratedMarkdownDraft, folderId: string | null) => Promise<void>;
  /** 크레딧 부족(402)으로 거절된 질문. 충전 뒤 다시 보낼 수 있게 입력을 되돌리는 데 쓴다(#153). */
  onInsufficientCredit?: (question: string) => void;
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
  const agentRequestRef = useRef<AbortController | null>(null);
  useEffect(() => () => agentRequestRef.current?.abort(), []);
  const [isCreatingMarkdown, setIsCreatingMarkdown] = useState(false);
  const [markdownCreateErrorMessage, setMarkdownCreateErrorMessage] = useState<string | null>(null);
  // 이 화면에서 작업 탭으로 보낸 turn ID. 서버가 채팅 답변으로 돌려줘도 작업 탭에 남긴다.
  const [taskRunIds, setTaskRunIds] = useState<ReadonlySet<string>>(() => new Set());
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
  const appliedTurnIds = useMemo(() => turnIdsWithOutcome(taskOutcomes, "applied"), [taskOutcomes]);
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

  /**
   * turn의 끝을 기다린 뒤 대화 목록을 다시 받아 결과를 보여 준다. 결과를 확인하지 못한 채 끝나면(조회 실패·연결 끊김)
   * 그 turn을 남겨 '다시 확인'으로 이어서 확인할 수 있게 한다.
   */
  function followTurnResult(
    controller: AbortController,
    question: string,
    run: () => Promise<AgentTurnResponse>,
    getTurnId: () => string | null
  ) {
    run()
      .then(async (response) => {
        if (controller.signal.aborted) return;
        await refreshMessages({ animateLatest: true });
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
        if (turnId && error instanceof AgentTurnLostError) {
          setUnconfirmedTurnId(turnId);
          // 결과를 확인하지 못해도 서버에 남은 진행 기록(진행 중 카드)이 보이도록 목록을 다시 받는다.
          void refreshMessages({ animateLatest: false }).catch(() => undefined);
        }
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
    setUnconfirmedTurnId(null);
    setAgentTurnErrorMessage(null);
    setIsAgentTurnLoading(true);
    setIsAgentTurnSlow(true);
    agentRequestRef.current?.abort();
    const controller = new AbortController();
    agentRequestRef.current = controller;
    followTurnResult(
      controller,
      agentTurnRequest?.message ?? "",
      () => resumeAgentTurn(turnId, { signal: controller.signal }),
      () => turnId
    );
  }

  const submitAgentTurn = useCallback((
    question: string,
    context: ActiveMarkdownEditContext | null,
    sessionId: string,
    model: AiModel,
    conversationPairIds: string[],
    /** 폴더를 대상으로 고른 스킬 실행이면 그 폴더. */
    folderId: string | null = null
  ) => {
    const request = buildAgentTurnRequest(question, context, {
      sessionId,
      selectedModel: { provider: model.provider, model: model.model },
      selectedPairIds: conversationPairIds,
      allowWebSearch,
      folderId
    });
    setAgentTurnRequest(request);
    setAgentTurnResponse(null);
    setAgentTurnErrorMessage(null);
    setMarkdownCreateErrorMessage(null);
    setIsAgentTurnLoading(true);
    setAgentStages([]);
    setIsAgentTurnSlow(false);
    setUnconfirmedTurnId(null);
    agentRequestRef.current?.abort();
    const controller = new AbortController();
    agentRequestRef.current = controller;
    let acceptedTurnId: string | null = null;
    followTurnResult(controller, question, () => requestAgentTurn(request, {
      signal: controller.signal,
      onAccepted: (requestId) => {
        acceptedTurnId = requestId;
        if (!controller.signal.aborted) setTaskRunIds((current) => new Set([...current, requestId]));
      },
      onStage: (stage) => {
        if (!controller.signal.aborted) setAgentStages((current) => [...current, stage]);
      },
      onSlow: () => { if (!controller.signal.aborted) setIsAgentTurnSlow(true); }
    }), () => acceptedTurnId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowWebSearch, refreshMessages, onInsufficientCredit]);

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
    submitAgentTurn(agentTurnRequest.message, needsDocument ? markdownEditContext ?? null : null, activeSessionId, selectedModel, selectedPairIds, agentTurnRequest.folder_id ?? null);
  }

  function applyMarkdownEdit() {
    if (editPreviewState?.preview) applyEditedMarkdown(editPreviewState.preview.nextMarkdown);
  }

  function applyEditedMarkdown(nextMarkdown: string) {
    if (!agentTurnRequest || !agentTurnResponse || !markdownEditContext || !editPreviewState?.preview) return;
    try {
      validateMarkdownEditApplication(agentTurnRequest, agentTurnResponse, markdownEditContext);
      const applied = markdownEditContext.applyMarkdown(
        agentTurnRequest.editorSnapshot?.markdown ?? "",
        nextMarkdown,
        agentTurnResponse.apply_operation_id
      );
      if (!applied) throw new Error("적용 직전에 문서가 변경되었습니다. 최신 내용으로 재생성해주세요.");
      markApplied(agentTurnResponse.requestId);
      setAgentTurnRequest(null);
      setAgentTurnResponse(null);
      setAgentTurnErrorMessage(null);
    } catch (error) {
      setAgentTurnErrorMessage(getErrorMessage(error, "편집 결과를 적용하지 못했습니다."));
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
    submitAgentTurn(`${agentTurnRequest.message}\n${instruction}`, markdownEditContext, activeSessionId, selectedModel, selectedPairIds, agentTurnRequest.folder_id ?? null);
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
    onCreateMarkdownDocument(draft, resolveGeneratedDocumentFolderId(agentTurnResponse))
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

  function createMarkdownDocument() {
    const draft = agentTurnResponse?.result.generated_markdown;
    if (!draft) return;
    setIsCreatingMarkdown(true);
    setMarkdownCreateErrorMessage(null);
    onCreateMarkdownDocument(draft, resolveGeneratedDocumentFolderId(agentTurnResponse))
      .then(() => {
        markApplied(agentTurnResponse?.requestId);
        setAgentTurnRequest(null);
        setAgentTurnResponse(null);
      })
      .catch((error: unknown) => {
        setMarkdownCreateErrorMessage(getErrorMessage(error, "새 Markdown 문서를 만들지 못했습니다."));
      })
      .finally(() => setIsCreatingMarkdown(false));
  }

  return {
    agentTurnRequest,
    agentTurnResponse,
    agentTurnErrorMessage,
    isAgentTurnLoading,
    isAgentTurnSlow,
    agentStages,
    canRecheckAgentTurn: unconfirmedTurnId !== null && !isAgentTurnLoading,
    recheckAgentTurn,
    isCreatingMarkdown,
    markdownCreateErrorMessage,
    editPreviewState,
    editPreviewErrorMessage,
    taskRunIds,
    appliedTurnIds,
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
