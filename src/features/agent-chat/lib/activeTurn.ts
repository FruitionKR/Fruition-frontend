import { findLastUserMessage } from "@/shared/lib/messages";
import type { ChatMessageRelatedPageResponse, ChatMessageResponse } from "@/entities/chat/model/chat";
import type { QueryRelatedPageResponse } from "@/entities/wiki/model/wiki";

export type ActiveAgentTurn = {
  question: string;
  userMessageId?: string;
  assistantMessage?: ChatMessageResponse;
};

/** 질의 응답의 related page를 채팅 메시지용 related page 형태로 변환한다. */
export function toRelatedPageMessage(page: QueryRelatedPageResponse, rank: number): ChatMessageRelatedPageResponse {
  return {
    wiki_page_id: page.id,
    page_type: page.page_type,
    title: page.title,
    slug: page.slug,
    relevance_score: page.relevance_score,
    role: page.role,
    depth: page.depth,
    rank
  };
}

/**
 * 새로 받은 메시지 목록에서 이번 질의로 생성된 assistant 메시지를 찾아
 * 다음 activeTurn 상태를 만든다. 새 assistant 메시지에 related_pages가 없으면
 * 질의 응답의 related_pages로 보강한다.
 */
export function buildNextActiveTurn(
  nextMessages: ChatMessageResponse[],
  previousAssistantMessageIds: Set<string>,
  queryRelatedPages: QueryRelatedPageResponse[],
  question: string
): ActiveAgentTurn {
  const nextAssistantMessage = [...nextMessages]
    .reverse()
    .find((message) => message.role !== "user" && !previousAssistantMessageIds.has(message.id));
  const nextAssistantMessageIndex = nextAssistantMessage
    ? nextMessages.findIndex((message) => message.id === nextAssistantMessage.id)
    : -1;
  const nextUserMessage = nextAssistantMessageIndex > 0
    ? findLastUserMessage(nextMessages.slice(0, nextAssistantMessageIndex))
    : undefined;

  const assistantMessage: ChatMessageResponse | undefined = nextAssistantMessage && !nextAssistantMessage.related_pages?.length && queryRelatedPages.length
    ? {
        ...nextAssistantMessage,
        related_pages: queryRelatedPages.map((page, idx) => toRelatedPageMessage(page, idx + 1))
      }
    : nextAssistantMessage;

  return {
    question: nextUserMessage?.content ?? question,
    userMessageId: nextUserMessage?.id,
    assistantMessage
  };
}
