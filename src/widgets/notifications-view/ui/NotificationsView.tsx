"use client";

import { useEffect, useId, useState } from "react";
import { cx } from "@/shared/lib/classNames";
import { formatNotificationTime, type NotificationCategory, type NotificationItem } from "../lib/notificationFeed";
import type { NotificationFeed } from "../model/useNotificationFeed";
import styles from "./NotificationsView.module.css";

// 알림 설정은 설정 모달에서만 바꾼다. 알림 화면에는 설정 탭을 두지 않는다.
const TABS: { id: NotificationCategory; label: string }[] = [
  { id: "workspace", label: "워크스페이스 알림" },
  { id: "task", label: "작업 알림" }
];

const EMPTY_MESSAGES: Record<NotificationCategory, string> = {
  workspace: "워크스페이스 알림이 없습니다.",
  task: "작업 알림이 없습니다."
};

/** 상대 시간("1분 전")을 다시 계산하는 주기 */
const CLOCK_TICK_MS = 60_000;

/** 알림 행 아이콘 (Figma 1486:3374 icon 32×32): 둥근 사각 배경 + 번개 */
function NotificationIcon() {
  return (
    <svg aria-hidden className={styles["row-icon"]} width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M12 0.799805H20C26.1856 0.799805 31.2002 5.81441 31.2002 12V20C31.2002 26.1856 26.1856 31.2002 20 31.2002H12C5.81441 31.2002 0.799805 26.1856 0.799805 20V12C0.799805 5.81441 5.81441 0.799805 12 0.799805Z" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.6" />
      <path d="M22.4889 14.8329L15.839 23.2616C15.604 23.5596 15.125 23.3933 15.125 23.0139V18.2148C15.125 17.9939 14.9459 17.8148 14.725 17.8148H9.82509C9.49094 17.8148 9.30409 17.4294 9.51106 17.1671L16.161 8.73836C16.396 8.44045 16.875 8.60665 16.875 8.98612V13.7852C16.875 14.0061 17.0541 14.1852 17.275 14.1852H22.1749C22.5091 14.1852 22.6959 14.5706 22.4889 14.8329Z" stroke="var(--color-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ABSOLUTE_TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

function NotificationRow({
  item,
  isUnread,
  isExpanded,
  now,
  onToggle,
  onOpenOperation
}: {
  item: NotificationItem;
  isUnread: boolean;
  isExpanded: boolean;
  now: number;
  onToggle: (item: NotificationItem) => void;
  onOpenOperation: (operationId: string) => void;
}) {
  const detailId = useId();
  return (
    <li className={cx(styles.row, isUnread && styles["is-unread"], isExpanded && styles["is-expanded"])}>
      <button
        type="button"
        className={styles["row-button"]}
        aria-expanded={isExpanded}
        aria-controls={detailId}
        onClick={() => onToggle(item)}
      >
        <NotificationIcon />
        <span className={styles["row-body"]}>
          <span className={styles["row-text"]}>
            <strong className={cx(styles["row-title"], item.tone === "failure" && styles["is-failure"])}>{item.title}</strong>
            <span className={styles["row-description"]}>{item.description}</span>
          </span>
          {item.changeCount !== null && <span className={styles["row-chip"]}>{item.changeCount}개 변경</span>}
        </span>
        <span className={styles["row-meta"]}>
          <span className={styles["row-dot"]} aria-hidden />
          {isUnread && <span className={styles["sr-only"]}>안 읽음</span>}
          <time dateTime={new Date(item.occurredAt).toISOString()}>{formatNotificationTime(item.occurredAt, now)}</time>
        </span>
      </button>
      {/* 누르면 화면을 옮기지 않고 짧은 설명을 펼친다. 작업 알림은 로그로 가는 버튼을 함께 둔다. */}
      <div id={detailId} className={styles["row-detail"]} hidden={!isExpanded}>
        <div className={styles["row-detail-inner"]}>
          <ul className={styles["detail-lines"]}>
            {item.details.map((line) => <li key={line}>{line}</li>)}
            <li className={styles["detail-time"]}>{ABSOLUTE_TIME_FORMAT.format(item.occurredAt)}</li>
          </ul>
          {item.operationId && (
            <button type="button" className={styles["detail-link"]} onClick={() => onOpenOperation(item.operationId!)}>
              로그에서 자세히 보기
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * 알림 화면 (Figma 1486:3011 목록). 레일 알림 종으로 연다.
 * 시안 상단 탭 바(GNB)는 웹에서는 쓰지 않아 뺐다.
 */
export function NotificationsView({
  feed,
  onOpenOperation
}: {
  feed: NotificationFeed;
  /** 작업 알림을 펼쳐 "로그에서 자세히 보기"를 누르면 로그 화면에서 그 작업을 연다 */
  onOpenOperation: (operationId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<NotificationCategory>("workspace");
  const [now, setNow] = useState(() => Date.now());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const tabIdPrefix = useId();

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  function toggleItem(item: NotificationItem) {
    feed.markRead(item.id);
    setExpandedId((current) => (current === item.id ? null : item.id));
  }

  const panelId = `${tabIdPrefix}-panel`;
  const list = feed[activeTab];

  return (
    <section className={styles.notifications} aria-labelledby={`${tabIdPrefix}-title`}>
      <header className={styles.hero}>
        <div className={styles.heading}>
          <h1 id={`${tabIdPrefix}-title`}>알림</h1>
          <p>알림 리스트입니다.</p>
        </div>
        <div className={styles.tabs}>
          <div role="tablist" aria-label="알림 종류" className={styles["tab-list"]}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${tabIdPrefix}-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={panelId}
                className={cx(styles.tab, activeTab === tab.id && styles["is-active"])}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {/* 레일 알림 종의 노란 점과 같은 표시. 이 탭에 안 읽은 알림이 있을 때만 보인다. */}
                {feed[tab.id].hasUnread && (
                  <>
                    <span className={styles["tab-badge"]} aria-hidden />
                    <span className={styles["sr-only"]}>안 읽은 알림 있음</span>
                  </>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles["read-all"]}
            disabled={!feed.hasUnread}
            onClick={feed.markAllRead}
          >
            전체 읽음 처리
          </button>
        </div>
      </header>

      <div id={panelId} role="tabpanel" aria-labelledby={`${tabIdPrefix}-tab-${activeTab}`} className={styles.panel}>
        {list.errorMessage ? (
          <p className={styles.message} role="alert">{list.errorMessage}</p>
        ) : list.isLoading ? (
          <p className={styles.message} role="status">알림을 불러오는 중입니다.</p>
        ) : list.items.length === 0 ? (
          <p className={styles.message}>{EMPTY_MESSAGES[activeTab]}</p>
        ) : (
          <ul className={styles.list}>
            {list.items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                isUnread={feed.isUnread(item)}
                isExpanded={expandedId === item.id}
                now={now}
                onToggle={toggleItem}
                onOpenOperation={onOpenOperation}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
