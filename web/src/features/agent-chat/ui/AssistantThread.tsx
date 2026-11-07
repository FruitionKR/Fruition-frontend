import { captureAnalytics } from "@/shared/lib/analytics/client";
import { Loader2, Square, Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import { AgentResultCard } from "./AgentResultCard";
import { StatusList } from "./StatusList";
import { AgentChevronIcon } from "./AgentIcons";
import { buildProgressSteps } from "../lib/progressSteps";
import { messageStatusTitle } from "../lib/statusSteps";
import { resolveChatTurnPresentation } from "../lib/agentTurn";
import { formatAnswerMarkdown } from "../lib/answerMarkdown";
import { useCitationLinks } from "../model/useCitationLinks";
import { buildSourceDocumentCards } from "../lib/relatedPageCards";
import type { ChatMessageResponse } from "@/entities/chat/model/chat";
import type { SpeechPlaybackState } from "../model/useSpeechPlayback";
import type { GraphNode } from "@/entities/wiki/model/wiki";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import { cx } from "@/shared/lib/classNames";
import styles from "./AgentChat.module.css";

/** 응답을 받지 못한(pending에 머문) 질의. released는 사용자가 닫은 질의다. */
export type StalledQueryView = {
  state: "stalled" | "released";
  /** 닫기(서버 취소 요청) 중 */
  isClosing: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
};

/** 질의 말풍선 자리의 '응답을 받지 못했어요' 안내와 다시 질문·닫기(작업 탭 stalled 카드와 같은 모양). */
function StalledQueryNotice({ stall }: { stall: StalledQueryView }) {
  const t = useTranslations("agentChat");
  if (stall.state === "released") return <p className={styles["task-note"]}>{t("stalled.queryReleasedDetail")}</p>;
  return (
    <div className={styles["stalled-query"]}>
      <p className={styles["task-note"]} role="alert">
        <strong>{t("stalled.turnTitle")}</strong>
        {"\n"}
        {t("stalled.queryDetail")}
      </p>
      {(stall.onRetry || stall.onDismiss) && (
        <div className={styles["task-actions"]}>
          {stall.onRetry && (
            <button type="button" className={cx(styles["task-pill"], styles["is-primary"])} disabled={stall.isClosing} onClick={stall.onRetry}>
              {t("actions.askAgain")}
            </button>
          )}
          {stall.onDismiss && (
            <button type="button" className={styles["task-pill"]} disabled={stall.isClosing} aria-busy={stall.isClosing || undefined} onClick={stall.onDismiss}>
              {stall.isClosing ? t("actions.closing") : t("actions.close")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 답변 공개 단계: 1=상태 목록만, 2=결과 카드까지, 3=답변 본문까지 표시
const STAGE_RESULTS = 2;
export const STAGE_ANSWER = 3;

/** assistant 메시지 하나를 상태 목록·결과 카드·답변 본문 순서로 렌더링한다. */
export function AssistantThread({
  message,
  isAnimated,
  visibleAnswerStage,
  nodes,
  onOpenSourceBlocks,
  speechPlayback = null,
  speechErrorMessage = null,
  onToggleSpeech,
  stall = null
}: {
  message: ChatMessageResponse;
  isAnimated: boolean;
  visibleAnswerStage: number;
  nodes?: GraphNode[];
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
  /** 지금 듣고 있는 답변(#149). 이 메시지가 아니면 버튼은 "듣기" 상태다. */
  speechPlayback?: SpeechPlaybackState;
  /** 이 메시지의 음성 재생 실패 안내. */
  speechErrorMessage?: string | null;
  onToggleSpeech?: (messageId: string) => void;
  /** 응답을 받지 못한 질의면 진행 표시 대신 안내와 다시 질문·닫기를 보인다. */
  stall?: StalledQueryView | null;
}) {
  const t = useTranslations("agentChat");
  const presentation = resolveChatTurnPresentation(message.action);
  // 진행 중에 취소돼 서버가 닫은 응답. 본문이 비어 있으면 "요청 취소됨" 상태 목록만 남긴다.
  const isCancelled = message.status === "cancelled";
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(true);
  const documentCommandAction = presentation.kind === "document-command" ? presentation.action : null;
  const isSearchAnswer = presentation.kind === "query" && presentation.grounded;
  // 완료된 답변만 서버가 음성으로 만든다(진행 중·실패는 409). 작업(계획) 문답은 작업 탭에 있어 여기 오지 않는다.
  const canListen = Boolean(onToggleSpeech) && message.status === "completed";
  const speechStatus = speechPlayback?.messageId === message.id ? speechPlayback.status : null;
  const resultCards = buildSourceDocumentCards(message, nodes, t);
  const citationLinks = useCitationLinks({ references: message.references, runId: message.run_id, nodes, onOpenSourceBlocks });

  return (
    <div className={cx(styles["agent-thread"], documentCommandAction && styles["is-document-command"])}>
      {stall && <StalledQueryNotice stall={stall} />}
      {!stall && ((message.progress?.length ?? 0) > 0 || message.status === "pending" || isCancelled) && (
        <StatusList
          title={messageStatusTitle(message.status, t)}
          isLoading={message.status === "pending"}
          hasResponse={message.status === "completed"}
          steps={message.progress?.length ? buildProgressSteps(message.progress, message.status === "pending", t)
            : isCancelled ? [] : [[t("status.sending"), "active"]]}
        />
      )}

      {isSearchAnswer && resultCards.length > 0 && (!isAnimated || visibleAnswerStage >= STAGE_RESULTS) && (
        <div className={cx(styles.results, isAnimated && styles["agent-stage"])}>
          <p>{t("sources.found", { count: resultCards.length })}</p>
          {resultCards.map((card) => (
            // 근거로 쓰인 원본 문서. 누르면 원본을 열고 근거 block을 강조한다.
            <AgentResultCard
              key={card.key}
              title={card.title}
              meta={card.meta}
              onClick={() => {
                if (message.run_id) captureAnalytics("citation_opened", { query_id: message.run_id, rank: card.highlights[0]?.rank ?? 1, citation_type: "internal", document_id: card.documentId });
                onOpenSourceBlocks(card.documentId, card.title, card.highlights);
              }}
            />
          ))}
        </div>
      )}

      {(!isAnimated || visibleAnswerStage >= STAGE_ANSWER) && !((stall || isCancelled) && !message.content.trim()) && (
        <section
          className={cx(styles["agent-answer"], isAnimated && styles["agent-stage"])}
          aria-label={isSearchAnswer ? t("chat.findings") : t("chat.answer")}
        >
          {isSearchAnswer && (
            <button
              type="button"
              className={styles["answer-section-title"]}
              aria-expanded={isAnswerExpanded}
              onClick={() => setIsAnswerExpanded((current) => !current)}
            >
              <span>{t("chat.findings")}</span>
              <AgentChevronIcon isWide className={isAnswerExpanded ? undefined : styles["is-collapsed"]} />
            </button>
          )}
          {(!isSearchAnswer || isAnswerExpanded) && <MarkdownViewer
            markdown={formatAnswerMarkdown(message.content)}
            linkPolicy="inert-external"
            {...citationLinks}
          />}
          {canListen && (
            <div className={styles["answer-actions"]}>
              <button
                type="button"
                className={cx(styles["answer-listen"], speechStatus && styles["is-active"])}
                aria-label={speechStatus ? t("speech.stopLabel") : t("speech.listenLabel")}
                aria-pressed={speechStatus !== null}
                aria-busy={speechStatus === "loading" || undefined}
                onClick={() => onToggleSpeech?.(message.id)}
              >
                {speechStatus === "loading"
                  ? <Loader2 size={14} aria-hidden className={styles["is-spinning"]} />
                  : speechStatus === "playing"
                    ? <Square size={11} aria-hidden />
                    : <Volume2 size={14} aria-hidden />}
                <span>{speechStatus === "loading" ? t("speech.preparing") : speechStatus === "playing" ? t("speech.stop") : t("speech.listen")}</span>
              </button>
            </div>
          )}
          {speechErrorMessage && <p className={styles["speech-error"]} role="alert">{speechErrorMessage}</p>}
        </section>
      )}
    </div>
  );
}
