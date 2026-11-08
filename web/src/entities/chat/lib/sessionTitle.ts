type TitleMessage = { role: string; content?: string | null };
type Session = { id: string; title: string | null };

/** 서버(document ChatSession.DEFAULT_TITLE)가 제목 없는 세션에 저장하는 기본 제목. 화면에는 그대로 보이지 않는다. */
export const SERVER_DEFAULT_CHAT_TITLE = "새 채팅";

export function isDefaultChatTitle(title: string | null | undefined): boolean {
  return !title?.trim() || title.trim() === SERVER_DEFAULT_CHAT_TITLE;
}

/**
 * 화면에 보일 세션 제목. 비었거나 서버 기본 제목이면 지금 언어의 기본 제목(defaultTitle)을 쓰고,
 * 사용자가 지은 제목이나 AI가 만든 제목은 그대로 둔다.
 */
export function chatSessionDisplayTitle(title: string | null | undefined, defaultTitle: string): string {
  return isDefaultChatTitle(title) ? defaultTitle : title!.trim();
}

/**
 * AI 제목이 아직 없으면 첫 질문으로 대화를 식별한다. 서버 제목을 덮어쓰지는 않는다.
 * 질문도 없으면 defaultTitle을 쓴다. 화면에 보일 값이면 지금 언어의 기본 제목을 넘기고,
 * 목록 상태에 저장해 isDefaultChatTitle로 다시 판정할 값이면 생략해 서버 기본 제목을 남긴다.
 */
export function chatSessionTitle(
  title: string | null | undefined,
  messages: readonly TitleMessage[] = [],
  defaultTitle: string = SERVER_DEFAULT_CHAT_TITLE
): string {
  if (!isDefaultChatTitle(title)) return title!.trim();
  const question = messages.find((message) => message.role === "user" && message.content?.trim())?.content;
  const text = question?.replace(/\s+/gu, " ").trim() ?? "";
  if (!text) return defaultTitle;
  const characters = Array.from(text);
  return characters.length > 30 ? `${characters.slice(0, 29).join("")}…` : text;
}

/** 예전 기본 제목도 목록에서 구분한다. 조회는 최대 4개씩, 닫힌 목록의 추가 조회는 중단한다. */
export async function resolveUntitledSessionTitles<T extends Session>(
  sessions: readonly T[],
  loadMessages: (sessionId: string) => Promise<{ messages: TitleMessage[] }>,
  isCancelled: () => boolean = () => false
): Promise<T[]> {
  const result = sessions.map((session) => ({ ...session }));
  const pending = result.filter((session) => isDefaultChatTitle(session.title));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (!isCancelled() && cursor < pending.length) {
      const session = pending[cursor++];
      try {
        const { messages } = await loadMessages(session.id);
        session.title = chatSessionTitle(session.title, messages);
      } catch {
        // 한 세션의 조회 실패로 나머지 대화 목록을 숨기지 않는다.
      }
    }
  }));
  return result;
}
