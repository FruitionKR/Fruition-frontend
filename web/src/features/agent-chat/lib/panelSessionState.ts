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

export function panelDraftStorageKey(scope: string, view: ChatChannel, sessionId: string | null): string {
  return `${scope}:draft:${view}:${sessionId ?? "empty"}`;
}
