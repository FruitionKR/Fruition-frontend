import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { MarkdownViewer } from "@/shared/ui/MarkdownViewer";
import { AgentResultCard } from "./AgentResultCard";
import { AgentPlanPreview } from "./AgentPlanPreview";
import { isWorkspacePlanAction } from "../lib/agentPlan";
import { StatusList } from "./StatusList";
import { buildProgressSteps } from "../lib/progressSteps";
import { resolveChatTurnPresentation } from "../lib/markdownAgent";
import { formatAnswerMarkdown } from "../lib/agentFormatters";
import { buildCitationRankMap } from "../lib/citationRanks";
import { buildRelatedPageCards, sourceTitle } from "../lib/relatedPageCards";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";
import type { GraphNode } from "@/entities/wiki/model/wiki";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import { cx } from "@/shared/lib/classNames";
import styles from "./AgentChat.module.css";

// 답변 공개 단계: 1=상태 목록만, 2=결과 카드까지, 3=답변 본문까지 표시
export const STAGE_RESULTS = 2;
export const STAGE_ANSWER = 3;

/** assistant 메시지 하나를 상태 목록·결과 카드·답변 본문 순서로 렌더링한다. */
export function AssistantThread({
  message,
  isAnimated,
  visibleAnswerStage,
  nodes,
  onOpenWikiPage,
  onOpenSourceBlocks
}: {
  message: ChatMessageResponse;
  isAnimated: boolean;
  visibleAnswerStage: number;
  nodes?: GraphNode[];
  onOpenWikiPage: (pageId: string, title: string, pageType: string) => void;
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
}) {
  const presentation = resolveChatTurnPresentation(message.action);
  const isWorkspacePlan = isWorkspacePlanAction(message.action);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(true);
  const documentCommandAction = presentation.kind === "document-command" ? presentation.action : null;
  const isSearchAnswer = presentation.kind === "query" && presentation.grounded;
  const resultCards = buildRelatedPageCards(message, nodes);
  const citationRankMap = useMemo(() => buildCitationRankMap(message.references), [message.references]);
  // 본문의 숫자 괄호는 모두 이 rank일 때만 citation이 된다(숫자 배열 오인 방지).
  const citableRanks = useMemo(
    () => new Set(message.references.flatMap((item) => item.rank && Number.isInteger(item.rank) && item.rank >= 1 ? [item.rank] : [])),
    [message.references]
  );
  const citationReferenceByRank = new Map(
    message.references
      .filter((item) => item.rank && item.source_document_id && item.source_block_ids?.length)
      .map((item) => [citationRankMap.get(item.rank!) ?? item.rank!, item])
  );
  const canOpenCitation = (rank: number) => citationReferenceByRank.has(rank);
  const openCitation = (rank: number) => {
    const reference = citationReferenceByRank.get(rank);
    if (!reference?.source_document_id || !reference.source_block_ids?.length) return;
    const highlights = [...new Set(reference.source_block_ids)].map((blockId) => ({ block_id: blockId, rank }));
    onOpenSourceBlocks(reference.source_document_id, sourceTitle(nodes, reference.source_document_id), highlights);
  };

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
            <AgentResultCard
              key={card.key}
              title={card.title}
              meta={card.meta}
              pageType={card.pageType}
              // raw 외 wiki page(source/concept·미지 타입)는 내부 구성(블록 참조 등)이 그대로 노출되므로 미리보기를 열지 않는다.
              onClick={card.pageType.toLowerCase() === "raw"
                ? () => onOpenWikiPage(card.pageId, card.title, card.pageType)
                : undefined}
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
              <ChevronDown size={8} className={isAnswerExpanded ? undefined : styles["is-collapsed"]} />
            </button>
          )}
          {isWorkspacePlan ? <AgentPlanPreview turnId={message.run_id} action={message.action!} /> : (!isSearchAnswer || isAnswerExpanded) && <MarkdownViewer
            markdown={formatAnswerMarkdown(message.content)}
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
