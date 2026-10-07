import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StatusList } from "./StatusList";
import { AssistantThread, STAGE_ANSWER } from "./AssistantThread";
import { groupMessagesByPair } from "../lib/messageGroups";
import { buildProgressSteps } from "../lib/progressSteps";
import type { QueryStageEvent } from "@/entities/wiki/api/wiki";
import type { ActiveAgentTurn } from "../model/useChatThread";
import type { ChatPairSelectionKind } from "../lib/chatPairSelection";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";
import type { GraphNode } from "@/entities/wiki/model/wiki";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import { cx } from "@/shared/lib/classNames";
import { useSmoothScroll } from "../lib/useSmoothScroll";
import styles from "./AgentChat.module.css";

const SEARCH_STATUS_TITLE = "서치 명령 실행 중";

function getPairSelectionLabel({
  isSelectable,
  isSelected,
  isExcluded,
  isIndividualSelection
}: {
  isSelectable: boolean;
  isSelected: boolean;
  isExcluded: boolean;
  isIndividualSelection: boolean;
}): string {
  if (!isSelectable) return isExcluded ? "선택 불가 · 문서·Skill 명령" : "선택 불가 · 완료된 문답이 아닙니다";
  // 개별 선택은 체크박스가 선택 상태를 보여 주므로 라벨에 ✓를 중복하지 않는다.
  if (isSelected) return isIndividualSelection ? "선택됨" : "✓ 선택됨";
  return isIndividualSelection ? "선택 가능 · 클릭하여 선택·해제" : "선택 가능 · 클릭하여 범위 지정";
}

export function AgentBody({
  messages,
  isLoading,
  isCancelling = false,
  isDocumentCommandLoading,
  documentCommandQuestion,
  documentCommandStages = [],
  activeSessionId,
  activeTurn,
  queryErrorMessage,
  chatLoadErrorMessage,
  animatedMessageId,
  queryStages = [],
  onOpenWikiPage,
  onOpenSourceBlocks,
  isPairSelectionMode,
  pairSelectionKind = "range",
  selectablePairIds,
  excludedPairIds,
  selectedPairIds,
  onSelectPair,
  nodes,
  documentCommandPreview
}: {
  messages: ChatMessageResponse[];
  isLoading: boolean;
  isCancelling?: boolean;
  isDocumentCommandLoading: boolean;
  documentCommandQuestion: string | null;
  documentCommandStages?: QueryStageEvent[];
  activeSessionId: string | null;
  activeTurn: ActiveAgentTurn | null;
  queryErrorMessage: string | null;
  chatLoadErrorMessage: string | null;
  animatedMessageId: string | null;
  queryStages?: QueryStageEvent[];
  onOpenWikiPage: (pageId: string, title: string, pageType: string) => void;
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
  isPairSelectionMode: boolean;
  pairSelectionKind?: ChatPairSelectionKind;
  selectablePairIds: string[];
  excludedPairIds: string[];
  selectedPairIds: string[];
  onSelectPair: (pairId: string) => void;
  nodes?: GraphNode[];
  /** 문서 명령 제안 카드. 대화 흐름의 마지막에 이어 붙는다. */
  documentCommandPreview?: ReactNode;
}) {
  const showAgentStatus = isLoading && activeTurn === null;
  const hasDocumentCommandPreview = documentCommandPreview != null;
  const [visibleAnswerStage, setVisibleAnswerStage] = useState(STAGE_ANSWER);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledInitialMessagesRef = useRef(false);
  const { scrollToPosition } = useSmoothScroll(bodyRef);

  useEffect(() => {
    hasScrolledInitialMessagesRef.current = false;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [activeSessionId]);

  const scrollToLatestMessage = useCallback(({ immediate = false } = {}) => {
    const body = bodyRef.current;
    if (!body) return;

    scrollToPosition(body.scrollHeight - body.clientHeight, { immediate });
  }, [scrollToPosition]);

  // 진행 단계는 SSE StatusList로 실시간 표시하므로, 답변 도착 시 지연 연출 없이 전체를 공개한다.
  useEffect(() => {
    setVisibleAnswerStage(STAGE_ANSWER);
  }, [animatedMessageId]);

  // 질문·답변이 항상 채팅창 맨 아래에 붙어 보이도록 최신 메시지로 스크롤한다.
  useLayoutEffect(() => {
    if (!activeTurn) return;

    const frameId = window.requestAnimationFrame(() => scrollToLatestMessage());
    return () => window.cancelAnimationFrame(frameId);
  }, [activeTurn, scrollToLatestMessage]);

  useLayoutEffect(() => {
    if (!animatedMessageId && !isLoading && !queryErrorMessage) return;

    const frameId = window.requestAnimationFrame(() => scrollToLatestMessage());
    return () => window.cancelAnimationFrame(frameId);
  }, [animatedMessageId, visibleAnswerStage, isLoading, activeTurn, queryErrorMessage, scrollToLatestMessage]);

  // 실제 제안 카드가 나타날 때만 내린다. 출처 열기 등으로 JSX가 다시 만들어져도 위치를 유지한다.
  useLayoutEffect(() => {
    if (!hasDocumentCommandPreview) return;

    const frameId = window.requestAnimationFrame(() => scrollToLatestMessage());
    return () => window.cancelAnimationFrame(frameId);
  }, [hasDocumentCommandPreview, scrollToLatestMessage]);

  // 전송 직후 추가된 질문·진행 UI가 화면 아래에 가려지지 않도록 한 번만 즉시 내린다.
  // 이후 단계 갱신에는 반응하지 않아 사용자가 직접 올린 스크롤 위치를 방해하지 않는다.
  useLayoutEffect(() => {
    if (!isLoading && !isDocumentCommandLoading) return;

    const frameId = window.requestAnimationFrame(() => scrollToLatestMessage({ immediate: true }));
    return () => window.cancelAnimationFrame(frameId);
  }, [isDocumentCommandLoading, isLoading, scrollToLatestMessage]);

  useEffect(() => {
    if (messages.length === 0 || animatedMessageId || isLoading || queryErrorMessage) return;
    if (hasScrolledInitialMessagesRef.current) return;

    hasScrolledInitialMessagesRef.current = true;
    const frameId = window.requestAnimationFrame(() => scrollToLatestMessage({ immediate: true }));
    return () => window.cancelAnimationFrame(frameId);
  }, [messages.length, animatedMessageId, isLoading, queryErrorMessage, scrollToLatestMessage]);

  const messageGroups = groupMessagesByPair(messages);
  const selectablePairIdSet = new Set(selectablePairIds);
  const excludedPairIdSet = new Set(excludedPairIds);
  const selectedPairIdSet = new Set(selectedPairIds);
  const isIndividualSelection = pairSelectionKind === "individual";
  // 개별 선택은 떨어진 문답을 각각 표시하므로 범위 시작·끝 테두리를 쓰지 않는다.
  const selectedRangeStart = isIndividualSelection ? null : selectedPairIds[0] ?? null;
  const selectedRangeEnd = isIndividualSelection ? null : selectedPairIds.at(-1) ?? null;
  // SSE로 받은 실제 진행 단계를 상태 목록으로 표시한다. 마지막 단계는 아직 진행 중이면 active로 둔다.
  const stageSteps = buildProgressSteps(queryStages, isLoading);
  const pendingStatusThread = (
    <div className={styles["agent-thread"]}>
      <StatusList
        title={isCancelling ? "질의 취소 중" : SEARCH_STATUS_TITLE}
        isLoading={isLoading}
        hasResponse={false}
        steps={isCancelling ? [["변경 복구 확인", "active"]] : stageSteps.length > 0 ? stageSteps : [["질문의 의도를 파악하고 있어요.", "active"]]}
      />
    </div>
  );

  return (
    <div className={cx(
      styles["agent-body"],
      isPairSelectionMode && styles["is-pair-selecting"],
      isPairSelectionMode && isIndividualSelection && styles["is-individual-selecting"]
    )} ref={bodyRef}>
      {messageGroups.map((group) => {
        const isSelectable = group.pairId !== null && selectablePairIdSet.has(group.pairId);
        const isExcluded = group.pairId !== null && excludedPairIdSet.has(group.pairId);
        const isSelected = group.pairId !== null && selectedPairIdSet.has(group.pairId);
        const isRangeStart = group.pairId !== null && group.pairId === selectedRangeStart;
        const isRangeEnd = group.pairId !== null && group.pairId === selectedRangeEnd;

        return (
          <div
            key={group.key}
            className={cx(
              styles["chat-pair"],
              isPairSelectionMode && isSelectable && styles["is-selection-candidate"],
              isPairSelectionMode && !isSelectable && styles["is-excluded"],
              isSelected && styles["is-selected"],
              isRangeStart && styles["is-range-start"],
              isRangeEnd && styles["is-range-end"]
            )}
            aria-disabled={isPairSelectionMode && !isSelectable ? true : undefined}
          >
            {isPairSelectionMode && (
              <div className={styles["chat-pair-selection-label"]}>
                {isIndividualSelection && isSelectable && (
                  <span className={styles["chat-pair-checkbox"]} aria-hidden="true">{isSelected ? "✓" : null}</span>
                )}
                {getPairSelectionLabel({ isSelectable, isSelected, isExcluded, isIndividualSelection })}
              </div>
            )}
            {isPairSelectionMode && isSelectable && (
              <button
                type="button"
                role={isIndividualSelection ? "checkbox" : undefined}
                className={styles["chat-selection-overlay"]}
                aria-checked={isIndividualSelection ? isSelected : undefined}
                aria-pressed={isIndividualSelection ? undefined : isSelected}
                aria-label={isIndividualSelection ? "이 문답을 편입 대상으로 선택" : "이 문답을 편입 범위로 선택"}
                onClick={() => onSelectPair(group.pairId as string)}
              />
            )}
            <div className={styles["chat-pair-content"]} inert={isPairSelectionMode}>
              {group.messages.map((message) => (
              message.role === "user" ? (
                <div className={styles["question-bubble"]} key={message.id}>
                  {message.content}
                </div>
              ) : (
                <AssistantThread
                  key={message.id}
                  message={message}
                  isAnimated={message.id === animatedMessageId}
                  visibleAnswerStage={visibleAnswerStage}
                  nodes={nodes}
                  onOpenWikiPage={onOpenWikiPage}
                  onOpenSourceBlocks={onOpenSourceBlocks}
                />
              )
              ))}
            </div>
          </div>
        );
      })}

      {activeTurn && (
        <>
          <div className={styles["question-bubble"]}>{activeTurn.question}</div>
          {pendingStatusThread}
        </>
      )}
      {showAgentStatus && pendingStatusThread}

      {isDocumentCommandLoading && documentCommandQuestion && (
        <>
          <div className={styles["question-bubble"]}>{documentCommandQuestion}</div>
          <div className={styles["agent-thread"]} role="status" aria-live="polite">
            <StatusList title="요청 처리 중" isLoading hasResponse={false}
              steps={documentCommandStages.length ? buildProgressSteps(documentCommandStages, true)
                : [["요청을 전달하고 있어요.", "active"]]} />
          </div>
        </>
      )}

      {documentCommandPreview}

      {queryErrorMessage && <p className={styles["query-error"]}>{queryErrorMessage}</p>}
      {chatLoadErrorMessage && <p className={styles["query-error"]}>{chatLoadErrorMessage}</p>}
    </div>
  );
}
