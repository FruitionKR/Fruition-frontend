type TitleMessage = { role: string; content?: string | null };
type Session = { id: string; title: string | null };

export function isDefaultChatTitle(title: string | null | undefined): boolean {
  return !title?.trim() || title.trim() === "새 채팅";
}

/** AI 제목이 아직 없으면 첫 질문으로 대화를 식별한다. 서버 제목을 덮어쓰지는 않는다. */
export function chatSessionTitle(title: string | null | undefined, messages: readonly TitleMessage[] = []): string {
  if (!isDefaultChatTitle(title)) return title!.trim();
  const question = messages.find((message) => message.role === "user" && message.content?.trim())?.content;
  const text = question?.replace(/\s+/gu, " ").trim() ?? "";
  if (!text) return "새 채팅";
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
