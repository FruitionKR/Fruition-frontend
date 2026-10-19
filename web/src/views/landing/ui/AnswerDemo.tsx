"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { nextTabIndex } from "../model/landingContent";
import styles from "./LandingMocks.module.css";

interface DemoSource {
  readonly kind: "document" | "concept";
  readonly label: string;
}

interface DemoAnswer {
  readonly key: string;
  readonly tab: string;
  readonly question: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** 문서 편집 예시처럼 줄 앞에 + 표시를 붙여 바뀐 내용을 보여줄지 */
  readonly isDiff?: boolean;
  readonly sources: readonly DemoSource[];
}

// 기능 설명용 예시 문답. 실제 AI 호출 없이 고정 문구만 보여준다.
const DEMO_ANSWERS: readonly DemoAnswer[] = [
  {
    key: "query",
    tab: "근거 있는 답변",
    question: "사용자 온보딩 개선 방향을 알려줘.",
    title: "저장된 기록을 바탕으로 정리했어요.",
    lines: [
      "제품 기획안과 고객 인터뷰에서 공통으로 나타난 방향은, 첫 사용자가 핵심 기능을 빠르게 경험하도록 돕는 것입니다.",
      "첫 화면의 안내를 간결하게 하고, 실제 문서 하나로 위키 편입과 질문 흐름을 경험하도록 구성해 보세요."
    ],
    sources: [
      { kind: "document", label: "제품 기획안" },
      { kind: "document", label: "고객 인터뷰" },
      { kind: "concept", label: "사용자 온보딩" }
    ]
  },
  {
    key: "edit",
    tab: "AI 문서 편집",
    question: "회의록에서 결정 사항만 골라 문서 끝에 정리해 줘.",
    title: "문서에 추가할 내용을 준비했어요.",
    lines: ["## 결정 사항", "첫 화면 안내를 세 단계로 줄인다.", "샘플 문서로 위키 편입을 먼저 보여준다."],
    isDiff: true,
    sources: [{ kind: "document", label: "주간 회의록" }]
  },
  {
    key: "skill",
    tab: "AI 스킬",
    question: "/주간 회고 실행",
    title: "‘주간 회고’ 스킬로 이번 주 기록을 정리했어요.",
    lines: ["잘된 점 · 온보딩 인터뷰 5건을 위키에 편입했습니다.", "다음 할 일 · 안내 문구 개선안을 팀과 검토합니다."],
    sources: [
      { kind: "document", label: "회의록 3개" },
      { kind: "concept", label: "온보딩 실험" }
    ]
  }
];

export function AnswerDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = DEMO_ANSWERS[activeIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(activeIndex, event.key, DEMO_ANSWERS.length);
    if (next === activeIndex) return;
    event.preventDefault();
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={styles["answer-demo"]}>
      <div className={styles["answer-tabs"]} role="tablist" aria-label="AI 활용 예시" onKeyDown={handleKeyDown}>
        {DEMO_ANSWERS.map((answer, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={answer.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`answer-tab-${answer.key}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`answer-panel-${answer.key}`}
              tabIndex={isActive ? 0 : -1}
              className={styles["answer-tab"]}
              onClick={() => setActiveIndex(index)}
            >
              {answer.tab}
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
        <p className={styles["answer-question"]}>{active.question}</p>
        <div className={styles["answer-row"]}>
          <span className={styles["answer-avatar"]} aria-hidden="true">
            ✳
          </span>
          <div className={styles["answer-card"]}>
            <p className={styles["answer-title"]}>{active.title}</p>
            <div className={active.isDiff ? styles["answer-diff"] : styles["answer-body"]}>
              {active.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <ul className={styles["answer-sources"]} aria-label="답변 근거">
              {active.sources.map((source) => (
                <li key={source.label} data-kind={source.kind}>
                  <span aria-hidden="true">{source.kind === "concept" ? "◇" : "↗"}</span>
                  {source.label}
                </li>
              ))}
            </ul>
            <p className={styles["answer-footnote"]}>기능 설명을 위한 예시 답변</p>
          </div>
        </div>
      </div>
    </div>
  );
}
