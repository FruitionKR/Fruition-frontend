import type { ChatMessageReferenceResponse } from "@/entities/chat/model/chat";
import type { SourceBlockHighlight } from "@/entities/document/model/document";
import type { GraphNode } from "@/entities/wiki/model/wiki";
import { MarkdownViewer } from "@/shared/ui/markdown/LazyMarkdownViewer";
import { formatAnswerMarkdown } from "../lib/answerMarkdown";
import { useCitationLinks } from "../model/useCitationLinks";
import styles from "./AgentChat.module.css";

/** 작업 탭의 대화형 답변(첨부 문서를 근거로 한 답 등). 채팅 답변처럼 Markdown으로 그리고 인용 번호로 근거 문서를 연다. */
export function TaskCitedAnswer({
  text,
  references,
  runId,
  nodes,
  onOpenSourceBlocks
}: {
  text: string;
  references: ChatMessageReferenceResponse[];
  runId: string | null;
  nodes: GraphNode[] | undefined;
  onOpenSourceBlocks: (documentId: string, title: string, highlights: SourceBlockHighlight[]) => void;
}) {
  const citationLinks = useCitationLinks({ references, runId, nodes, onOpenSourceBlocks });
  return (
    <div className={styles["task-answer"]}>
      <MarkdownViewer markdown={formatAnswerMarkdown(text)} linkPolicy="inert-external" {...citationLinks} />
    </div>
  );
}
