import type { ChatMessageRelatedPageResponse, ChatMessageResponse } from "@/entities/chat/model/chat";
import type { QueryRelatedPageResponse } from "@/entities/wiki/model/wiki";

/** 질의 응답의 related page를 채팅 메시지용 related page 형태로 변환한다. */
function toRelatedPageMessage(page: QueryRelatedPageResponse, rank: number): ChatMessageRelatedPageResponse {
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
 * 새로 받은 메시지 목록에서 이번 질의로 생성된 assistant 메시지를 찾는다.
 * 그 메시지에 related_pages가 없으면 질의 응답의 related_pages로 보강한다.
 * 보강한 메시지를 목록 안에 그대로 두어야 다른 문답과 같이 그려지고 편입 범위로 선택된다.
 */
export function mergeQueryAnswer(
  nextMessages: ChatMessageResponse[],
  previousAssistantMessageIds: Set<string>,
  queryRelatedPages: QueryRelatedPageResponse[]
): { messages: ChatMessageResponse[]; answerMessageId: string | null } {
  const answer = [...nextMessages]
    .reverse()
    .find((message) => message.role !== "user" && !previousAssistantMessageIds.has(message.id));
  if (!answer) return { messages: nextMessages, answerMessageId: null };
  if (answer.related_pages?.length || !queryRelatedPages.length) {
    return { messages: nextMessages, answerMessageId: answer.id };
  }
  const enriched: ChatMessageResponse = {
    ...answer,
    related_pages: queryRelatedPages.map((page, idx) => toRelatedPageMessage(page, idx + 1))
  };
  return {
    messages: nextMessages.map((message) => (message.id === answer.id ? enriched : message)),
    answerMessageId: answer.id
  };
}
