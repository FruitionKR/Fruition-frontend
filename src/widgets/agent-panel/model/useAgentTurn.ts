import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStageEvent } from "@/shared/lib/runEvents";
import type { AiModel } from "@/entities/ai";
import { requestAgentTurn } from "@/features/agent-chat";
import {
  buildAgentTurnRequest,
  prepareMarkdownEditPreview,
  resolveChatTurnPresentation,
  validateMarkdownEditApplication
} from "@/features/agent-chat/lib/markdownAgent";
import type { AgentTurnRequest, AgentTurnResponse, GeneratedMarkdownDraft, MarkdownEditPreview as MarkdownEditPreviewData } from "@/features/agent-chat/lib/markdownAgent";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import { getErrorMessage } from "@/shared/lib/errors";

/**
 * 노트를 열어 둔 채 보내는 문서 명령(agent turn): 요청·진행 단계·응답과
 * 그 결과로 보여 주는 편집 미리보기·적용·새 Markdown 문서 만들기.
 */
export function useAgentTurn({
  markdownEditContext,
  activeSessionId,
  selectedModel,
  selectedPairIds,
  allowWebSearch,
  refreshMessages,
  onCreateMarkdownDocument
}: {
  markdownEditContext: ActiveMarkdownEditContext | null | undefined;
  activeSessionId: string | null;
  selectedModel: AiModel | null;
  selectedPairIds: string[];
  allowWebSearch: boolean;
  /** 응답이 오면 대화 목록을 다시 받아 새 문답을 이어 붙인다. */
  refreshMessages: (options: { animateLatest: boolean }) => Promise<unknown>;
  onCreateMarkdownDocument: (draft: GeneratedMarkdownDraft) => Promise<void>;
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
    context: ActiveMarkdownEditContext,
    sessionId: string,
    model: AiModel,
    conversationPairIds: string[]
  ) => {
    const request = buildAgentTurnRequest(question, context, {
      sessionId,
      selectedModel: { provider: model.provider, model: model.model },
      selectedPairIds: conversationPairIds,
      allowWebSearch
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
        setAgentTurnErrorMessage(getErrorMessage(error, "AI 편집 요청에 실패했습니다."));
      })
      .finally(() => { if (!controller.signal.aborted) setIsAgentTurnLoading(false); });
  }, [allowWebSearch, refreshMessages]);

  function dismissAgentTurnResult() {
    setAgentTurnRequest(null);
    setAgentTurnResponse(null);
    setAgentTurnErrorMessage(null);
    setMarkdownCreateErrorMessage(null);
  }

  function regenerateAgentTurn() {
    if (!agentTurnRequest || !markdownEditContext || !activeSessionId || !selectedModel) {
      setAgentTurnErrorMessage("편집 중인 문서를 다시 열고 재생성해주세요.");
      return;
    }
    submitAgentTurn(agentTurnRequest.message, markdownEditContext, activeSessionId, selectedModel, selectedPairIds);
  }

  function applyMarkdownEdit() {
    if (!agentTurnRequest || !agentTurnResponse || !markdownEditContext || !editPreviewState?.preview) return;
    try {
      validateMarkdownEditApplication(agentTurnRequest, agentTurnResponse, markdownEditContext);
      const applied = markdownEditContext.applyMarkdown(
        agentTurnRequest.editorSnapshot.markdown,
        editPreviewState.preview.nextMarkdown,
        agentTurnResponse.apply_operation_id
      );
      if (!applied) throw new Error("적용 직전에 문서가 변경되었습니다. 최신 내용으로 재생성해주세요.");
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
    onCreateMarkdownDocument(draft)
      .then(() => {
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
    onCreateMarkdownDocument(draft)
      .then(() => {
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
    submitAgentTurn,
    dismissAgentTurnResult,
    regenerateAgentTurn,
    applyMarkdownEdit,
    openMarkdownEditAsNewDocument,
    createMarkdownDocument
  };
}
