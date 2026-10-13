import { useCallback, useMemo, useState } from "react";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import { AgentResultCard } from "./AgentResultCard";
import { AgentPlanPreview } from "./AgentPlanPreview";
import { isWorkspacePlanAction } from "../lib/agentPlan";
import { StatusList } from "./StatusList";
import { AgentChevronIcon } from "./AgentIcons";
import { buildProgressSteps } from "../lib/progressSteps";
import { resolveChatTurnPresentation } from "../lib/agentTurn";
import { formatAnswerMarkdown } from "../lib/answerMarkdown";
import { buildCitationRankMap, buildCitationReferenceByRank } from "../lib/citationRanks";
import { buildSourceDocumentCards, sourceTitle } from "../lib/relatedPageCards";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";
import type { GraphNode } from "@/entities/wiki/model/wiki";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import { cx } from "@/shared/lib/classNames";
import styles from "./AgentChat.module.css";

// 답변 공개 단계: 1=상태 목록만, 2=결과 카드까지, 3=답변 본문까지 표시
const STAGE_RESULTS = 2;
export const STAGE_ANSWER = 3;

/** assistant 메시지 하나를 상태 목록·결과 카드·답변 본문 순서로 렌더링한다. */
export function AssistantThread({
  message,
  isAnimated,
  visibleAnswerStage,
  nodes,
  onOpenSourceBlocks
}: {
  message: ChatMessageResponse;
  isAnimated: boolean;
  visibleAnswerStage: number;
  nodes?: GraphNode[];
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
}) {
  const presentation = resolveChatTurnPresentation(message.action);
  const isWorkspacePlan = isWorkspacePlanAction(message.action);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(true);
  const documentCommandAction = presentation.kind === "document-command" ? presentation.action : null;
  const isSearchAnswer = presentation.kind === "query" && presentation.grounded;
  const resultCards = buildSourceDocumentCards(message, nodes);
  const citationRankMap = useMemo(() => buildCitationRankMap(message.references), [message.references]);
  // 본문의 숫자 괄호는 모두 이 rank일 때만 citation이 된다(숫자 배열 오인 방지).
  const citableRanks = useMemo(
    () => new Set(message.references.flatMap((item) => item.rank && Number.isInteger(item.rank) && item.rank >= 1 ? [item.rank] : [])),
    [message.references]
  );
  const citationReferenceByRank = useMemo(
    () => buildCitationReferenceByRank(message.references, citationRankMap),
    [message.references, citationRankMap]
  );
  // MarkdownViewer가 memo라 콜백 identity를 고정해야 폴링 리렌더마다 본문을 다시 그리지 않는다.
  const canOpenCitation = useCallback((rank: number) => citationReferenceByRank.has(rank), [citationReferenceByRank]);
  const openCitation = useCallback((rank: number) => {
    const reference = citationReferenceByRank.get(rank);
    if (!reference?.source_document_id || !reference.source_block_ids?.length) return;
    const highlights = [...new Set(reference.source_block_ids)].map((blockId) => ({ block_id: blockId, rank }));
    onOpenSourceBlocks(reference.source_document_id, sourceTitle(nodes, reference.source_document_id), highlights);
  }, [citationReferenceByRank, nodes, onOpenSourceBlocks]);

  return (
    <div className={cx(styles["agent-thread"], documentCommandAction && styles["is-document-command"])}>
      {!isWorkspacePlan && ((message.progress?.length ?? 0) > 0 || message.status === "pending") && (
        <StatusList
          title={message.status === "pending" ? "요청 처리 중" : message.status === "completed" ? "요청 처리 완료" : "요청 처리 종료"}
          isLoading={message.status === "pending"}
          hasResponse={message.status === "completed"}
          steps={message.progress?.length ? buildProgressSteps(message.progress, message.status === "pending")
            : [["요청을 전달하고 있어요.", "active"]]}
        />
      )}

      {isSearchAnswer && resultCards.length > 0 && (!isAnimated || visibleAnswerStage >= STAGE_RESULTS) && (
        <div className={cx(styles.results, isAnimated && styles["agent-stage"])}>
          <p>찾은 자료 {resultCards.length}건</p>
          {resultCards.map((card) => (
            // 근거로 쓰인 원본 문서. 누르면 원본을 열고 근거 block을 강조한다.
            <AgentResultCard
              key={card.key}
              title={card.title}
              meta={card.meta}
              onClick={() => onOpenSourceBlocks(card.documentId, card.title, card.highlights)}
            />
          ))}
        </div>
      )}

      {(!isAnimated || visibleAnswerStage >= STAGE_ANSWER) && (
        <section
          className={cx(styles["agent-answer"], isAnimated && styles["agent-stage"])}
          aria-label={isSearchAnswer ? "실행 중 발견 사항" : "답변"}
        >
          {isSearchAnswer && (
            <button
              type="button"
              className={styles["answer-section-title"]}
              aria-expanded={isAnswerExpanded}
              onClick={() => setIsAnswerExpanded((current) => !current)}
            >
              <span>실행 중 발견 사항</span>
              <AgentChevronIcon isWide className={isAnswerExpanded ? undefined : styles["is-collapsed"]} />
            </button>
          )}
          {isWorkspacePlan ? <AgentPlanPreview turnId={message.run_id} action={message.action!} /> : (!isSearchAnswer || isAnswerExpanded) && <MarkdownViewer
            markdown={formatAnswerMarkdown(message.content)}
            linkPolicy="inert-external"
            onCitationClick={openCitation}
            canClickCitation={canOpenCitation}
            citationRankMap={citationRankMap}
            citableRanks={citableRanks}
          />}
        </section>
      )}
    </div>
  );
}
