"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { nextTabIndex } from "../model/landingContent";
import styles from "./LandingTabs.module.css";

export interface LandingTabPanel {
  readonly key: string;
  readonly tab: string;
  /** 서버에서 그린 패널 내용. 탭 전환만 클라이언트에서 한다. */
  readonly content: ReactNode;
}

/** 랜딩의 탭(활용 사례). WAI-ARIA 탭 패턴: 좌우 화살표·Home·End로 이동하고 선택한 패널만 보인다. */
export function LandingTabs({ label, idPrefix, panels }: { label: string; idPrefix: string; panels: readonly LandingTabPanel[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = panels[activeIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(activeIndex, event.key, panels.length);
    if (next === activeIndex) return;
    event.preventDefault();
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  };

  if (!active) return null;

  return (
    <div className={styles["tabs"]}>
      <div className={styles["tab-list"]} role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
        {panels.map((panel, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={panel.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${idPrefix}-tab-${panel.key}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${idPrefix}-panel-${panel.key}`}
              tabIndex={isActive ? 0 : -1}
              className={styles["tab"]}
              onClick={() => setActiveIndex(index)}
            >
              {panel.tab}
            </button>
          );
        })}
      </div>
      <div
        key={active.key}
        id={`${idPrefix}-panel-${active.key}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${active.key}`}
        tabIndex={0}
        className={styles["panel"]}
      >
        {active.content}
      </div>
    </div>
  );
}
