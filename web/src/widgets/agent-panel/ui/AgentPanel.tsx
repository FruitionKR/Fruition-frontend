"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AgentBody } from "@/features/agent-chat/ui/AgentBody";
import { AgentComposer } from "@/features/agent-chat/ui/AgentComposer";
import { AgentHeader } from "@/features/agent-chat/ui/AgentHeader";
import { MarkdownCreatePreview } from "@/features/agent-chat/ui/MarkdownCreatePreview";
import { MarkdownEditPreview } from "@/features/agent-chat/ui/MarkdownEditPreview";
import { useChatThread } from "@/features/agent-chat/model/useChatThread";
import { fetchCurrentChatSessionId } from "@/entities/chat";
import { publishNotice } from "@/features/document-notifications";
import { exportChatWiki, getChatExportSuccessMessage, type ChatWikiExportResponse } from "@/features/wiki-export";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import type { GeneratedMarkdownDraft } from "@/features/agent-chat/lib/agentTurn";
import { fetchChatSessions } from "@/entities/chat/api/chat";
import type { ActiveMarkdownEditContext } from "@/features/agent-chat/lib/markdownEditContext";
import {
  classifyChatExportPairs,
  EMPTY_CHAT_PAIR_RANGE_SELECTION,
  selectChatPairRange,
  toggleChatPair,
  type ChatPairRangeSelection,
  type ChatPairSelectionKind
} from "@/features/agent-chat/lib/chatPairSelection";
import type { SourceBlockHighlight } from "@/entities/document";
import type { GraphNode } from "@/entities/wiki";
import { useAgentTurn } from "../model/useAgentTurn";
import { useAiModelSelection } from "../model/useAiModelSelection";
import styles from "@/features/agent-chat/ui/AgentChat.module.css";

const PAIR_SELECTION_KIND_OPTIONS: { kind: ChatPairSelectionKind; label: string }[] = [
  { kind: "range", label: "범위 선택" },
  { kind: "individual", label: "개별 선택" }
];

export function AgentPanel({
  onClose,
  onOpenSourceBlocks,
  onCreateMarkdownDocument,
  markdownEditContext,
  onDocumentExported,
  nodes,
  composerDraft,
  wikiEvidenceNotice,
  isShown = true
}: {
  onClose: () => void;
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
  onCreateMarkdownDocument: (draft: GeneratedMarkdownDraft) => Promise<void>;
  markdownEditContext?: ActiveMarkdownEditContext | null;
  onDocumentExported?: (response: ChatWikiExportResponse) => Promise<void> | void;
  nodes?: GraphNode[];
  /** 입력창에 채울 문장(스킬 실행의 "/slug "). id가 바뀔 때마다 한 번 채운다 */
  composerDraft?: { id: number; text: string } | null;
  /** 열린 노트가 위키 미편입·편입 후 수정 상태일 때 composer 위에 띄우는 안내. */
  wikiEvidenceNotice?: {
    message: string;
    actionLabel: string | null;
    isDisabled: boolean;
    isIngesting: boolean;
    onIngest: () => void;
  } | null;
  /** 패널이 화면에 보이는지. 패널 없는 화면에서는 마운트된 채 숨겨진다. */
  isShown?: boolean;
}) {
  const [composerValue, setComposerValue] = useState("");
  const restoreComposerQuestion = useCallback((question: string) => {
    setComposerValue((current) => current || question);
  }, []);
  useEffect(() => {
    if (composerDraft) setComposerValue(composerDraft.text);
  }, [composerDraft]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);
  const [isPairSelectionMode, setIsPairSelectionMode] = useState(false);
  const [pairSelection, setPairSelection] = useState<ChatPairRangeSelection>(EMPTY_CHAT_PAIR_RANGE_SELECTION);
  const [pairSelectionKind, setPairSelectionKind] = useState<ChatPairSelectionKind>("range");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null);
  // 마운트 시 현재 활성 세션을 확보해 헤더 강조·메시지 로드의 기준으로 삼는다.
  useEffect(() => {
    fetchCurrentChatSessionId().then(setActiveSessionId).catch(() => undefined);
  }, []);
  const {
    aiModels,
    selectedModel,
    aiModelCatalogStatus,
    aiModelsErrorMessage,
    allowWebSearch,
    handleWebSearchChange,
    handleModelChange
  } = useAiModelSelection();
  const {
    messages,
    queryErrorMessage,
    chatLoadErrorMessage,
    animatedMessageId,
    activeTurn,
    isLoading,
    isCancelling,
    queryStatusMessage,
    queryStages,
    hasPendingMessages,
    refreshMessages,
    submitQuery,
    cancelQuery
  } = useChatThread(activeSessionId);
  const { selectablePairIds: exportPairIds, excludedPairIds } = useMemo(
    () => classifyChatExportPairs(messages),
    [messages]
  );
  const selectedPairIds = pairSelection.selectedPairIds;
  const agentTurn = useAgentTurn({
    markdownEditContext,
    activeSessionId,
    selectedModel,
    selectedPairIds,
    allowWebSearch,
    refreshMessages,
    onCreateMarkdownDocument,
    // 크레딧 부족 거절은 충전 뒤 다시 보낼 수 있게 입력을 되돌린다(#153).
    onInsufficientCredit: restoreComposerQuestion
  });
  const { agentTurnRequest, agentTurnResponse, isAgentTurnLoading, isCreatingMarkdown, editPreviewState } = agentTurn;
  const isSubmitting = isLoading || isAgentTurnLoading || isCreatingMarkdown || hasPendingMessages;
  const sessionTitle = activeSessionTitle ?? "새 채팅";
  const completedReplies = messages.filter((message) => message.role === "assistant" && message.status === "completed").length;
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function loadTitle() {
      attempts += 1;
      try {
        const response = await fetchChatSessions();
        if (cancelled) return;
        const title = response.sessions.find((session) => session.id === activeSessionId)?.title ?? null;
        setActiveSessionTitle(title);
        if (completedReplies > 0 && (!title || title === "새 채팅") && attempts < 30) {
          timer = setTimeout(loadTitle, 2000);
        }
      } catch {
        // 제목 조회 실패가 대화 표시를 막지는 않는다.
      }
    }
    void loadTitle();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeSessionId, completedReplies]);
  const composerPlaceholder = "AI 에이전트에게 무엇이든 물어보세요.";

  function handleSubmit() {
    const question = composerValue.trim();
    if (!question || isSubmitting) return;
    if (markdownEditContext) {
      if (!activeSessionId || !selectedModel) return;
      setComposerValue("");
      agentTurn.submitAgentTurn(question, markdownEditContext, activeSessionId, selectedModel, selectedPairIds);
      return;
    }
    // 질의 경로는 provider/model 쌍이 반드시 필요하다. 카탈로그를 못 받았으면 입력을 지우지 않고 멈춘다.
    if (!selectedModel) return;
    setComposerValue("");
    void submitQuery(question, { provider: selectedModel.provider, model: selectedModel.model }, allowWebSearch).then((insufficientCredit) => {
      // 크레딧 부족 거절은 충전 뒤 다시 보낼 수 있게 입력을 되돌린다(#153).
      if (insufficientCredit) setComposerValue((current) => current || question);
    });
  }

  function startPairSelection() {
    if (isSubmitting || isExporting || exportPairIds.length === 0) return;
    setExportErrorMessage(null);
    setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
    setIsPairSelectionMode(true);
  }

  function selectPair(pairId: string) {
    if (isExporting) return;
    const select = pairSelectionKind === "individual" ? toggleChatPair : selectChatPairRange;
    setPairSelection((current) => select(exportPairIds, current, pairId));
  }

  function changePairSelectionKind(kind: ChatPairSelectionKind) {
    if (isExporting || kind === pairSelectionKind) return;
    // 범위 선택과 개별 선택은 선택 규칙이 달라 모드를 바꾸면 선택을 처음부터 다시 한다.
    setPairSelectionKind(kind);
    setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
  }

  function cancelPairSelection() {
    setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
    setIsPairSelectionMode(false);
  }

  async function acceptExport() {
    if (selectedPairIds.length === 0) return;
    setExportErrorMessage(null);
    setIsExporting(true);
    try {
      const response = await exportChatWiki(selectedPairIds);
      setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
      setIsPairSelectionMode(false);
      try {
        await onDocumentExported?.(response);
        publishNotice({
          kind: "completed",
          title: "채팅 편입 완료",
          message: getChatExportSuccessMessage(response.status)
        });
      } catch (error: unknown) {
        const detail = getErrorMessage(error, "워크스페이스 목록 갱신에 실패했습니다.");
        const message = `문서는 저장했지만 워크스페이스 목록을 갱신하지 못했습니다. 페이지를 새로고침해 주세요. (${detail})`;
        setExportErrorMessage(message);
        publishNotice({ kind: "failed", title: "문서 목록 갱신 실패", message });
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, "채팅을 문서로 편입하지 못했습니다.");
      setExportErrorMessage(message);
      publishNotice({
        kind: "failed",
        title: "채팅 편입 실패",
        message: `${message} 처리 결과가 불확실할 수 있으니 문서 목록을 확인해 주세요.`
      });
    } finally {
      setIsExporting(false);
    }
  }

  // 문서 명령 제안은 대화 흐름 안에 이어 붙인다. 편입 선택 모드에서는 대화가 선택 UI로 바뀌므로 내보내지 않는다.
  const hasDocumentCommandPreview = !isPairSelectionMode && Boolean(
    (agentTurnResponse?.result.action === "markdown_create" && agentTurnResponse.result.generated_markdown)
    || editPreviewState?.preview
  );
  const documentCommandPreview = hasDocumentCommandPreview ? (
    <>
      {agentTurnResponse?.result.action === "markdown_create" && agentTurnResponse.result.generated_markdown && (
        <MarkdownCreatePreview
          draft={agentTurnResponse.result.generated_markdown}
          isSubmitting={isCreatingMarkdown}
          errorMessage={agentTurn.markdownCreateErrorMessage}
          onCancel={agentTurn.dismissAgentTurnResult}
          onRegenerate={agentTurn.regenerateAgentTurn}
          onCreate={agentTurn.createMarkdownDocument}
        />
      )}
      {editPreviewState?.preview && (
        <MarkdownEditPreview
          preview={editPreviewState.preview}
          validationError={editPreviewState.validationError}
          isLoading={isAgentTurnLoading || isCreatingMarkdown}
          onApply={agentTurn.applyMarkdownEdit}
          onCancel={agentTurn.dismissAgentTurnResult}
          onOpenAsNewDocument={agentTurn.openMarkdownEditAsNewDocument}
          onRegenerate={agentTurn.regenerateAgentTurn}
        />
      )}
    </>
  ) : null;

  return (
    <aside
      className={`agent-panel${isPairSelectionMode ? " is-chat-selecting" : ""}`}
      onClick={(event) => event.stopPropagation()}
    >
      <AgentHeader
        sessionTitle={sessionTitle}
        onClose={onClose}
        activeSessionId={activeSessionId}
        isInteractionLocked={isSubmitting || isExporting}
        canStartWikiExport={exportPairIds.length > 0 && !isSubmitting && !isExporting}
        onStartWikiExport={startPairSelection}
        onSelectSession={(sessionId, title) => {
          setActiveSessionId(sessionId);
          setActiveSessionTitle(title);
          // 이전 세션에서 고른 부분 편입 선택이 새 세션으로 새어나가지 않도록 초기화한다.
          setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION);
          setIsPairSelectionMode(false);
        }}
      />
      <AgentBody
        messages={messages}
        isLoading={isLoading}
        isCancelling={isCancelling}
        isDocumentCommandLoading={isAgentTurnLoading}
        documentCommandStages={agentTurn.agentStages}
        documentCommandQuestion={isAgentTurnLoading ? agentTurnRequest?.message ?? null : null}
        activeSessionId={activeSessionId}
        isShown={isShown}
        activeTurn={activeTurn}
        queryErrorMessage={
          agentTurn.agentTurnErrorMessage
          ?? agentTurn.editPreviewErrorMessage
          ?? (markdownEditContext ? null : aiModelsErrorMessage)
          ?? queryErrorMessage
        }
        chatLoadErrorMessage={chatLoadErrorMessage}
        animatedMessageId={animatedMessageId}
        queryStages={queryStages}
        onOpenSourceBlocks={onOpenSourceBlocks}
        isPairSelectionMode={isPairSelectionMode}
        pairSelectionKind={pairSelectionKind}
        selectablePairIds={exportPairIds}
        excludedPairIds={excludedPairIds}
        selectedPairIds={selectedPairIds}
        onSelectPair={selectPair}
        nodes={nodes}
        documentCommandPreview={documentCommandPreview}
      />
      {isPairSelectionMode ? (
        <div className={styles["chat-selection-actions"]}>
          <div className={styles["chat-selection-toolbar"]}>
            <div className={styles["chat-selection-kind"]} role="group" aria-label="편입 문답 선택 방식">
              {PAIR_SELECTION_KIND_OPTIONS.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={pairSelectionKind === kind}
                  className={styles["chat-selection-kind-option"]}
                  disabled={isExporting}
                  onClick={() => changePairSelectionKind(kind)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles["chat-selection-buttons"]}>
              <button
                type="button"
                className={styles["chat-selection-reset"]}
                aria-label="채팅 선택 다시 하기"
                disabled={isExporting || selectedPairIds.length === 0}
                onClick={() => setPairSelection(EMPTY_CHAT_PAIR_RANGE_SELECTION)}
              >
                <RotateCcw size={16} />
              </button>
              <button type="button" className={styles["chat-selection-cancel"]} disabled={isExporting} onClick={cancelPairSelection}>
                취소
              </button>
              <button
                type="button"
                className={styles["chat-selection-confirm"]}
                aria-label={selectedPairIds.length > 0 ? `${selectedPairIds.length}개 문답 편입 확인` : "편입할 문답을 선택하세요"}
                disabled={isExporting || selectedPairIds.length === 0}
                onClick={() => void acceptExport()}
              >
                확인
              </button>
            </div>
          </div>
          {exportErrorMessage && <p className={styles["chat-selection-error"]} role="alert">{exportErrorMessage}</p>}
        </div>
      ) : null}
      <div className={styles["composer-region"]}>
        {wikiEvidenceNotice && !isPairSelectionMode && (
          <div className={styles["wiki-evidence-notice"]}>
            <p role="status">{wikiEvidenceNotice.message}</p>
            {wikiEvidenceNotice.actionLabel && (
              <button type="button" disabled={wikiEvidenceNotice.isDisabled} onClick={wikiEvidenceNotice.onIngest}>
                {wikiEvidenceNotice.isIngesting ? "위키 편입 중…" : wikiEvidenceNotice.actionLabel}
              </button>
            )}
          </div>
        )}
        <AgentComposer
          value={composerValue}
          isLoading={isSubmitting || isPairSelectionMode}
          placeholder={composerPlaceholder}
          models={aiModels}
          selectedModel={selectedModel}
          modelCatalogStatus={aiModelCatalogStatus}
          canSubmit={!isPairSelectionMode && activeSessionId !== null && selectedModel !== null}
          onModelChange={handleModelChange}
          allowWebSearch={allowWebSearch}
          onWebSearchChange={handleWebSearchChange}
          onChange={setComposerValue}
          onSubmit={handleSubmit}
          onCancel={isLoading ? cancelQuery : undefined}
          isCancelling={isCancelling}
          statusMessage={queryStatusMessage}
        />
      </div>
    </aside>
  );
}
