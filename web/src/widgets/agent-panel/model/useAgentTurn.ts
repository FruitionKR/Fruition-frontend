import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStageEvent } from "@/shared/lib/runEventStream";
import type { AiModel } from "@/entities/ai";
import { requestAgentTurn } from "@/features/agent-chat";
import {
  buildAgentTurnRequest,
  prepareMarkdownEditPreview,
  resolveChatTurnPresentation,
  resolveGeneratedDocumentFolderId,
  validateMarkdownEditApplication
} from "@/features/agent-chat/lib/agentTurn";
import type { AgentTurnRequest, AgentTurnResponse, GeneratedMarkdownDraft, MarkdownEditPreview as MarkdownEditPreviewData } from "@/features/agent-chat/lib/agentTurn";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import { getErrorMessage, isInsufficientCreditError } from "@/shared/lib/apiErrors";

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
  const agentRequestRef = useRef<AbortController | null>(null);
  useEffect(() => () => agentRequestRef.current?.abort(), []);
  const [isCreatingMarkdown, setIsCreatingMarkdown] = useState(false);
  const [markdownCreateErrorMessage, setMarkdownCreateErrorMessage] = useState<string | null>(null);
  // 이 화면에서 작업 탭으로 보낸 turn ID. 서버가 채팅 답변으로 돌려줘도 작업 탭에 남긴다.
  const [taskRunIds, setTaskRunIds] = useState<ReadonlySet<string>>(() => new Set());
  // 편집안을 적용했거나 새 문서로 만든 turn ID. 작업 목록에서 "저장됨"으로 보인다.
  const [appliedTurnIds, setAppliedTurnIds] = useState<ReadonlySet<string>>(() => new Set());
  const markApplied = useCallback((turnId: string | undefined) => {
    if (turnId) setAppliedTurnIds((current) => new Set([...current, turnId]));
  }, []);

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
  const editPreviewErrorMessage = editPreviewState && !editPreviewState.preview
    ? `${editPreviewState.validationError ?? "편집 결과를 적용할 수 없습니다."} 원문은 변경되지 않았습니다. 최신 문서에서 다시 요청해주세요.`
    : null;

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
    agentRequestRef.current?.abort();
    const controller = new AbortController();
    agentRequestRef.current = controller;
    requestAgentTurn(request, {
      signal: controller.signal,
      onAccepted: (requestId) => {
        if (!controller.signal.aborted) setTaskRunIds((current) => new Set([...current, requestId]));
      },
      onStage: (stage) => {
        if (!controller.signal.aborted) setAgentStages((current) => [...current, stage]);
      }
    })
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
      })
      .finally(() => { if (!controller.signal.aborted) setIsAgentTurnLoading(false); });
  }, [allowWebSearch, refreshMessages, onInsufficientCredit]);

  function dismissAgentTurnResult() {
    setAgentTurnRequest(null);
    setAgentTurnResponse(null);
    setAgentTurnErrorMessage(null);
    setMarkdownCreateErrorMessage(null);
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
    if (!agentTurnRequest || !agentTurnResponse || !markdownEditContext || !editPreviewState?.preview) return;
    try {
      validateMarkdownEditApplication(agentTurnRequest, agentTurnResponse, markdownEditContext);
      const applied = markdownEditContext.applyMarkdown(
        agentTurnRequest.editorSnapshot?.markdown ?? "",
        editPreviewState.preview.nextMarkdown,
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
    agentStages,
    isCreatingMarkdown,
    markdownCreateErrorMessage,
    editPreviewState,
    editPreviewErrorMessage,
    taskRunIds,
    appliedTurnIds,
    submitAgentTurn,
    dismissAgentTurnResult,
    regenerateAgentTurn,
    applyMarkdownEdit,
    openMarkdownEditAsNewDocument,
    createMarkdownDocument
  };
}
