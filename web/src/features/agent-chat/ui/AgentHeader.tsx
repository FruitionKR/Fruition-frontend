import { MoreVertical, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createChatSession, deleteChatSession } from "@/entities/chat/api/chat";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useDismissOnOutside } from "@/shared/hooks/useDismissOnOutside";
import type { ChatSessionResponse } from "@/entities/chat/model/chat";
import { chatBubbleIcon, fruitionLogo, sidebarToggleIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { cx } from "@/shared/lib/classNames";
import { AgentAssetIcon, AgentChevronIcon, AgentMoreIcon } from "./AgentIcons";
import styles from "./AgentChat.module.css";

export type AgentPanelView = "chat" | "work";

/** 헤더 보기 탭이 가리키는 본문(tabpanel) id. 패널은 화면에 하나뿐이다. */
export const AGENT_PANEL_VIEW_IDS: Record<AgentPanelView, string> = { chat: "agent-panel-view-chat", work: "agent-panel-view-work" };

const VIEW_TABS: { view: AgentPanelView; label: string }[] = [
  { view: "chat", label: "채팅" },
  { view: "work", label: "작업" }
];

/**
 * 채팅 패널 헤더(Figma 1571:28010 GNB): 대화 제목 탭(제목 + 셰브론 = 세션 목록 드롭다운)
 * + "채팅 | 작업" 보기 탭(1571:28015) + 옵션(⋯)·패널 숨기기 버튼
 */
export function AgentHeader({
  activeView,
  onViewChange,
  sessionTitle,
  onClose,
  activeSessionId,
  isInteractionLocked,
  onSelectSession,
  loadSessions,
  canStartWikiExport,
  onStartWikiExport
}: {
  activeView: AgentPanelView;
  onViewChange: (view: AgentPanelView) => void;
  sessionTitle: string;
  onClose: () => void;
  activeSessionId: string | null;
  isInteractionLocked: boolean;
  onSelectSession: (sessionId: string, title: string | null) => void;
  loadSessions: () => Promise<{ sessions: ChatSessionResponse[] }>;
  canStartWikiExport: boolean;
  onStartWikiExport: () => void;
}) {
  const [isListOpen, setIsListOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessions, setSessions] = useState<ChatSessionResponse[]>([]);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  // 세션 생성 요청 진행 중 여부. 연타로 인한 중복 POST를 막는다.
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  // 행 옵션 메뉴는 스크롤 컨테이너에 클리핑되지 않도록 portal(fixed)로 띄운다.
  const [rowMenu, setRowMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isInteractionLocked) return;
    setIsListOpen(false);
    setIsMenuOpen(false);
    setRowMenu(null);
  }, [isInteractionLocked]);

  useDismissOnOutside(menuRef, isMenuOpen, () => setIsMenuOpen(false));

  // 성공 여부를 반환해 호출부가 실패 시 에러 표시 상태(목록 열림)를 유지할 수 있게 한다.
  async function startNewChat() {
    if (isCreatingChat) return false;
    setIsMenuOpen(false);
    setIsCreatingChat(true);
    try {
      const created = await createChatSession();
      onSelectSession(created.id, created.title);
      return true;
    } catch (error: unknown) {
      setLoadErrorMessage(getErrorMessage(error, "새 채팅을 만들지 못했습니다."));
      return false;
    } finally {
      setIsCreatingChat(false);
    }
  }

  // 현재 채팅을 삭제하면 남은 세션 중 첫 번째로 전환하고, 없으면 새 채팅을 만든다.
  // 다른 세션을 삭제하면 목록만 갱신한다.
  async function handleDeleteSession(sessionId: string) {
    setRowMenu(null);
    try {
      await deleteChatSession(sessionId);
      const response = await loadSessions();
      const remaining = response.sessions ?? [];
      setSessions(remaining);
      if (sessionId !== activeSessionId) return;
      if (remaining[0]) onSelectSession(remaining[0].id, remaining[0].title);
      else await startNewChat();
    } catch (error: unknown) {
      setLoadErrorMessage(getErrorMessage(error, "채팅을 삭제하지 못했습니다."));
    }
  }

  useEffect(() => {
    if (!isListOpen) setRowMenu(null);
  }, [isListOpen]);

  useDismissOnOutside(rootRef, isListOpen, () => setIsListOpen(false));

  useEffect(() => {
    if (!isListOpen) return;

    let cancelled = false;
    loadSessions()
      .then((response) => {
        if (cancelled) return;
        setSessions(response.sessions ?? []);
        setLoadErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadErrorMessage(getErrorMessage(error, "채팅 세션을 불러오지 못했습니다."));
      });

    return () => {
      cancelled = true;
    };
  }, [isListOpen, sessionTitle, loadSessions]);

  // 세션 title이 없으면 헤더와 동일하게 "새 채팅"으로 표시한다
  const fallbackTitle = "새 채팅";
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleSessions = sessions.filter((session) =>
    (session.title ?? fallbackTitle).toLowerCase().includes(normalizedSearch)
  );

  return (
    <div className={styles["agent-header"]} ref={rootRef}>
      {/* 대화 탭(Figma 1571:28011 tog): 제목과 오른쪽 셰브론 전체가 세션 목록 드롭다운을 연다. 새 채팅은 ⋯ 메뉴·목록 하단에서 시작한다. */}
      <div className={styles["agent-session-tab"]}>
        <button
          type="button"
          className={styles["agent-session-title"]}
          aria-expanded={isListOpen}
          aria-haspopup="true"
          title={sessionTitle}
          disabled={isInteractionLocked}
          onClick={() => setIsListOpen((open) => !open)}
        >
          <span>{sessionTitle}</span>
          <AgentChevronIcon isWide strokeWidth={1.6} className={cx(styles["agent-session-chevron"], isListOpen && styles["is-open"])} />
        </button>
      </div>
      <div className={styles["agent-header-actions"]}>
        <div className={styles["agent-view-tabs"]} role="tablist" aria-label="채팅 패널 보기">
          {VIEW_TABS.map(({ view, label }) => {
            const isSelected = view === activeView;
            return (
              <button
                key={view}
                type="button"
                role="tab"
                id={`${AGENT_PANEL_VIEW_IDS[view]}-tab`}
                aria-selected={isSelected}
                aria-controls={AGENT_PANEL_VIEW_IDS[view]}
                tabIndex={isSelected ? 0 : -1}
                className={cx(styles["agent-view-tab"], isSelected && styles["is-selected"])}
                onClick={() => onViewChange(view)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const next = VIEW_TABS[(VIEW_TABS.findIndex((tab) => tab.view === view) + 1) % VIEW_TABS.length].view;
                  onViewChange(next);
                  document.getElementById(`${AGENT_PANEL_VIEW_IDS[next]}-tab`)?.focus();
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className={styles["agent-header-menu"]} ref={menuRef}>
          <button
            type="button"
            className={styles["panel-action"]}
            aria-label="채팅 옵션"
            aria-expanded={isMenuOpen}
            disabled={isInteractionLocked}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <AgentMoreIcon />
          </button>
          {isMenuOpen && (
            <div className={styles["agent-header-menu-list"]} role="menu">
              <button type="button" role="menuitem" onClick={startNewChat}>새 채팅</button>
              <button
                type="button"
                role="menuitem"
                disabled={!canStartWikiExport}
                onClick={() => {
                  setIsMenuOpen(false);
                  onStartWikiExport();
                }}
              >
                채팅을 문서로 편입
              </button>
            </div>
          )}
        </div>
        <button type="button" className={styles["panel-action"]} aria-label="Agent 패널 숨기기" onClick={onClose}>
          <SvgIcon src={sidebarToggleIcon} className={styles["panel-toggle-icon"]} />
        </button>
      </div>

      {isListOpen && (
        <div className={styles["chat-session-dropdown"]}>
          <label className={styles["chat-session-search"]}>
            <Search size={12} />
            <input
              aria-label="채팅 검색"
              value={searchTerm}
              placeholder="채팅 검색"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          {loadErrorMessage ? (
            <p className={styles["chat-session-error"]} role="alert">{loadErrorMessage}</p>
          ) : visibleSessions.length === 0 ? (
            <p className={styles["chat-session-empty"]}>채팅 세션이 없습니다.</p>
          ) : (
            <div className={styles["chat-session-list"]}>
              {visibleSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                <div
                  key={session.id}
                  className={cx(styles["chat-session-item"], isActive && styles["is-active"])}
                >
                  <button
                    type="button"
                    className={styles["chat-session-select"]}
                    disabled={isInteractionLocked}
                    onClick={() => {
                      setRowMenu(null);
                      onSelectSession(session.id, session.title ?? fallbackTitle);
                      setIsListOpen(false);
                    }}
                  >
                    {isActive
                      ? <AgentAssetIcon src={fruitionLogo} size={14} className={styles["chat-session-logo"]} />
                      : <SvgIcon src={chatBubbleIcon} className={styles["chat-session-icon"]} />}
                    <span className={styles["chat-session-label"]}>{session.title ?? fallbackTitle}</span>
                  </button>
                  <div className={styles["chat-session-menu"]}>
                    <button
                      type="button"
                      className={styles["chat-session-more"]}
                      aria-label="채팅 옵션"
                      aria-expanded={rowMenu?.id === session.id}
                      disabled={isInteractionLocked}
                      onClick={(event) => {
                        if (rowMenu?.id === session.id) {
                          setRowMenu(null);
                          return;
                        }
                        const rect = event.currentTarget.getBoundingClientRect();
                        setRowMenu({ id: session.id, top: rect.bottom + 4, left: rect.right - 132 });
                      }}
                    >
                      <MoreVertical size={12} />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className={styles["chat-session-new"]}
            disabled={isInteractionLocked || isCreatingChat}
            onClick={() => {
              // 실패 시 목록을 열어 둔 채 에러 문구를 보여주기 위해 성공했을 때만 닫는다.
              void startNewChat().then((created) => {
                if (created) setIsListOpen(false);
              });
            }}
          >
            <Plus size={12} />
            <span>새 채팅</span>
          </button>
        </div>
      )}

      {rowMenu && createPortal(
        <div
          className={styles["chat-session-menu-list"]}
          role="menu"
          style={{ top: rowMenu.top, left: rowMenu.left }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={styles["is-danger"]}
            onClick={() => handleDeleteSession(rowMenu.id)}
          >
            삭제
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
