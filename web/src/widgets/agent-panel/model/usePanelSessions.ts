import { useCallback, useEffect, useRef, useState } from "react";
import { createChatSession, fetchChatSessionMessages, fetchChatSessions } from "@/entities/chat/api/chat";
import { chatSessionTitle, isDefaultChatTitle } from "@/entities/chat/lib/sessionTitle";
import type { ChatSessionResponse } from "@/entities/chat/model/chat";
import { useMe } from "@/entities/user/model/useMe";
import { isTaskMessage } from "@/features/agent-chat/lib/taskThread";
import { emptyPanelSessionState, findReusableEmptySession, panelSessionStorageKey, parsePanelSessionState, selectPanelSession, type ChatChannel, type PanelSessionState, type SessionChannel } from "@/features/agent-chat/lib/panelSessionState";
import { getSelectedWorkspaceId } from "@/shared/lib/authSessionStorage";
import { getErrorMessage, isChatSessionLimitError } from "@/shared/lib/apiErrors";

type CatalogSession = ChatSessionResponse & { channel: SessionChannel; isEmpty: boolean };

/** 본문은 서버의 별도 세션에, 탭별 마지막 선택은 사용자·워크스페이스별 브라우저 저장소에 둔다. */
export function usePanelSessions(view: ChatChannel) {
  const me = useMe();
  const workspaceId = getSelectedWorkspaceId();
  const scope = me.data?.id && workspaceId ? panelSessionStorageKey(me.data.id, workspaceId) : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const stateRef = useRef<PanelSessionState>(emptyPanelSessionState());
  const creating = useRef<Partial<Record<ChatChannel, Promise<ChatSessionResponse>>>>({});
  const refreshing = useRef<{ scope: string; promise: Promise<CatalogSession[]> } | null>(null);
  const [snapshot, setSnapshot] = useState<{ scope: string | null; state: PanelSessionState }>({ scope: null, state: emptyPanelSessionState() });
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimFailures, setClaimFailures] = useState<Partial<Record<ChatChannel, unknown>>>({});

  const commit = useCallback((next: PanelSessionState) => {
    if (!scope || scopeRef.current !== scope) return;
    stateRef.current = next;
    setSnapshot({ scope, state: next });
    try { window.localStorage.setItem(scope, JSON.stringify(next)); } catch { /* 저장이 막혀도 현재 화면은 쓸 수 있다. */ }
  }, [scope]);

  const refresh = useCallback(async () => {
    if (!scope || !workspaceId) return [];
    if (refreshing.current?.scope === scope) return refreshing.current.promise;
    const promise = (async () => {
      const selectedAtStart = { ...stateRef.current.selected };
      const response = await fetchChatSessions();
      const sessions = response.sessions ?? [];
      const storedChannels = { ...stateRef.current.channels };
      const catalog: CatalogSession[] = sessions.map(session => ({ ...session, channel: storedChannels[session.id] ?? "chat", isEmpty: false }));
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, catalog.length) }, async () => {
        while (scopeRef.current === scope && cursor < catalog.length) {
          const session = catalog[cursor++];
          if (storedChannels[session.id] && !isDefaultChatTitle(session.title)) continue;
          // 분류에 실패한 기록은 임의로 다른 탭에 배정하지 않고 목록 조회를 다시 시도한다.
          const { messages } = await fetchChatSessionMessages(session.id, workspaceId);
          if (!storedChannels[session.id]) {
            const work = messages.some(message => isTaskMessage(message));
            const chat = messages.some(message => !isTaskMessage(message));
            session.channel = work && chat ? "legacy" : work ? "work" : "chat";
          }
          session.isEmpty = isDefaultChatTitle(session.title) && messages.length === 0;
          session.title = chatSessionTitle(session.title, messages);
        }
      }));
      if (scopeRef.current !== scope) return [];
      const next = { ...stateRef.current, channels: Object.fromEntries(catalog.map(session => [session.id, session.channel])) };
      for (const channel of ["chat", "work"] as const) {
        const currentSelected = stateRef.current.selected[channel];
        if (currentSelected && currentSelected !== selectedAtStart[channel]) {
          next.channels[currentSelected] = stateRef.current.channels[currentSelected];
          continue;
        }
        const selected = catalog.find(session => session.id === next.selected[channel] && (session.channel === channel || session.channel === "legacy"));
        next.selected = { ...next.selected, [channel]: selected?.id ?? catalog.find(session => session.channel === channel)?.id ?? null };
      }
      commit(next);
      return catalog;
    })();
    refreshing.current = { scope, promise };
    try { return await promise; }
    finally { if (refreshing.current?.promise === promise) refreshing.current = null; }
  }, [commit, scope, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setReadyScope(null);
    setError(null);
    setClaimFailures({});
    creating.current = {};
    if (!scope) return;
    try { stateRef.current = parsePanelSessionState(window.localStorage.getItem(scope)); }
    catch { stateRef.current = emptyPanelSessionState(); }
    void refresh().then(() => { if (!cancelled) setReadyScope(scope); }).catch(reason => {
      if (!cancelled) setError(getErrorMessage(reason, "대화 목록을 불러오지 못했습니다."));
    });
    return () => { cancelled = true; };
  }, [refresh, scope]);

  const select = useCallback((channel: ChatChannel, id: string) => {
    commit(selectPanelSession(stateRef.current, channel, id));
  }, [commit]);

  /** 탭에 쓸 세션을 정한다. 빈 세션이 있으면 재사용하고, 없을 때만 새로 만든다. 동시 호출은 한 요청으로 묶는다. */
  const claimSession = useCallback(async (channel: ChatChannel) => {
    if (!scope || readyScope !== scope) throw new Error("대화를 준비 중입니다. 잠시 후 다시 시도해 주세요.");
    let pending = creating.current[channel];
    if (!pending) {
      pending = (async () => {
        const catalog = await refresh();
        const session = findReusableEmptySession(catalog, stateRef.current.selected, channel) ?? await createChatSession();
        if (scopeRef.current !== scope) throw new Error("워크스페이스가 변경됐습니다.");
        commit(selectPanelSession(stateRef.current, channel, session.id, channel));
        return session;
      })();
      creating.current[channel] = pending;
    }
    try {
      const session = await pending;
      setClaimFailures(({ [channel]: _resolved, ...rest }) => rest);
      return session;
    } finally {
      if (creating.current[channel] === pending) delete creating.current[channel];
    }
  }, [commit, readyScope, refresh, scope]);

  const ensureWritable = useCallback(async (channel: ChatChannel) => {
    const selected = stateRef.current.selected[channel];
    // 이전 통합 대화는 열람할 수 있지만 새 요청은 항상 분리된 새 세션에 쓴다.
    if (selected && stateRef.current.channels[selected] === channel) return selected;
    return (await claimSession(channel)).id;
  }, [claimSession]);

  const state = snapshot.scope === scope ? snapshot.state : emptyPanelSessionState();
  const ready = scope !== null && readyScope === scope;
  const selectedInView = state.selected[view];
  // 세션 목록을 다시 받아도 선택이 그대로면 다시 시도하지 않는다. 한도에 닿은 채로 요청을 반복하지 않게 하며, 탭을 오가면 다시 시도한다.
  useEffect(() => {
    if (!ready || selectedInView) return;
    void ensureWritable(view).catch(reason => setClaimFailures(current => ({ ...current, [view]: reason })));
  }, [ensureWritable, ready, selectedInView, view]);

  const loadSessions = useCallback(async () => {
    const catalog = await refresh();
    if (scopeRef.current === scope) {
      setReadyScope(scope);
      setError(null);
    }
    return { sessions: catalog.filter(session => session.channel === view || session.channel === "legacy") };
  }, [refresh, scope, view]);

  const claimFailure = claimFailures[view];
  const isAtSessionLimit = isChatSessionLimitError(claimFailure);
  const claimError = claimFailure && !isAtSessionLimit ? getErrorMessage(claimFailure, "대화를 만들지 못했습니다.") : null;

  return { scope, ready, error: error ?? claimError, isAtSessionLimit, selected: state.selected, channels: state.channels, activeChannel: state.channels[state.selected[view] ?? ""], select, ensureWritable, startNewSession: claimSession, loadSessions };
}
