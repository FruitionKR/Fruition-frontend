"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { nextTabIndex } from "../model/landingContent";
import styles from "./AnswerDemo.module.css";

export interface AnswerDemoPanel {
  readonly key: string;
  readonly tab: string;
  /** 미리보기는 장식이라 스크린리더에는 이 설명을 읽어 준다. */
  readonly description: string;
  /** 서버에서 그린 앱 화면 미리보기. 탭 전환만 클라이언트에서 한다. */
  readonly content: ReactNode;
}

/** 활용 장의 예시 화면 탭(근거 있는 답변 · AI 문서 편집 · AI 스킬). 화면은 고정 예시이며 AI를 호출하지 않는다. */
export function AnswerDemo({ panels }: { panels: readonly AnswerDemoPanel[] }) {
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
    <div className={styles["answer-demo"]}>
      <div className={styles["answer-tabs"]} role="tablist" aria-label="AI 활용 예시" onKeyDown={handleKeyDown}>
        {panels.map((panel, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={panel.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`answer-tab-${panel.key}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`answer-panel-${panel.key}`}
              tabIndex={isActive ? 0 : -1}
              className={styles["answer-tab"]}
              onClick={() => setActiveIndex(index)}
            >
              {panel.tab}
            </button>
          );
        })}
      </div>
      <div
        key={active.key}
        id={`answer-panel-${active.key}`}
        role="tabpanel"
        aria-labelledby={`answer-tab-${active.key}`}
        className={styles["answer-panel"]}
      >
        <p className={styles["sr-only"]}>{active.description}</p>
        {active.content}
      </div>
    </div>
  );
}
