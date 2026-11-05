export type ChatChannel = "chat" | "work";
export type SessionChannel = ChatChannel | "legacy";
export type PanelSessionState = {
  channels: Record<string, SessionChannel>;
  selected: Record<ChatChannel, string | null>;
};

export function emptyPanelSessionState(): PanelSessionState {
  return { channels: {}, selected: { chat: null, work: null } };
}

export function panelSessionStorageKey(userId: string, workspaceId: string): string {
  return `fruition.panel-sessions.v1:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

export function parsePanelSessionState(raw: string | null): PanelSessionState {
  const result = emptyPanelSessionState();
  try {
    const parsed = JSON.parse(raw ?? "null");
    if (!parsed || typeof parsed !== "object") return result;
    for (const [id, channel] of Object.entries(parsed.channels ?? {})) {
      if (channel === "chat" || channel === "work" || channel === "legacy") {
        Object.defineProperty(result.channels, id, { value: channel, enumerable: true, configurable: true, writable: true });
      }
    }
    for (const view of ["chat", "work"] as const) {
      const id = parsed.selected?.[view];
      if (typeof id === "string" && (result.channels[id] === view || result.channels[id] === "legacy")) result.selected[view] = id;
    }
  } catch { /* 이전·손상된 저장값은 빈 상태로 시작한다. */ }
  return result;
}

export function selectPanelSession(state: PanelSessionState, view: ChatChannel, id: string, channel = state.channels[id] ?? view): PanelSessionState {
  if (channel !== view && channel !== "legacy") throw new Error("다른 탭의 대화 세션을 선택할 수 없습니다.");
  return { channels: { ...state.channels, [id]: channel }, selected: { ...state.selected, [view]: id } };
}

/**
 * 메시지가 없는 세션은 어느 탭에든 쓸 수 있어 새로 만들지 않고 재사용한다. 탭 구분은 브라우저 저장소에만 있어
 * 새 브라우저에서는 빈 세션이 모두 채팅으로 분류되므로, 재사용하지 않으면 작업 탭을 열 때마다 빈 세션이 쌓인다.
 * 다른 탭이 보고 있는 세션은 뺀다.
 */
export function findReusableEmptySession<T extends { id: string; isEmpty: boolean }>(
  sessions: readonly T[],
  selected: PanelSessionState["selected"],
  view: ChatChannel
): T | null {
  const otherTabSession = selected[view === "chat" ? "work" : "chat"];
  return sessions.find((session) => session.isEmpty && session.id !== otherTabSession) ?? null;
}

/**
 * 저장된 선택이 없을 때(새 브라우저 등) 탭에 먼저 열 세션. 목록은 최근 순이라 다른 기기에서 만든 빈 세션이 맨 앞에 올 수 있다.
 * 내용이 있는 세션을 먼저 고른다.
 */
export function pickInitialSession<T extends { channel: string; isEmpty: boolean }>(sessions: readonly T[], view: ChatChannel): T | null {
  const inView = sessions.filter((session) => session.channel === view);
  return inView.find((session) => !session.isEmpty) ?? inView[0] ?? null;
}

/** 지금 키의 초안 값. 이 키로 입력한 적이 없으면 저장소에서 읽은 값이라 복원으로 본다. */
export function resolvePanelDraft(draft: { key: string | null; value: string }, key: string | null, read: (key: string | null) => string): { value: string; isRestored: boolean } {
  return draft.key === key ? { value: draft.value, isRestored: false } : { value: read(key), isRestored: true };
}

export function panelDraftStorageKey(scope: string, view: ChatChannel, sessionId: string | null): string {
  return `${scope}:draft:${view}:${sessionId ?? "empty"}`;
}

/** 채팅 탭 입력창에 붙인 첨부를 초안처럼 세션별로 저장하는 키. 세션이 없으면 저장하지 않는다. */
export function panelAttachmentStorageKey(scope: string | null, sessionId: string | null): string | null {
  return scope && sessionId ? `${scope}:attachments:chat:${sessionId}` : null;
}
