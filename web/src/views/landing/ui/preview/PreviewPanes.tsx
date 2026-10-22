import type { ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import { sidebarToggleIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { SidebarWorkspaceChevronIcon } from "@/widgets/document-sidebar/ui/SidebarIcons";
import base from "./Preview.module.css";
import styles from "./PreviewPanes.module.css";

/*
 * Agent 패널 조각. Figma 1540:19718(채팅 · 근거 답변), 1571:27625(작업 탭 · 본문 제안), 1540:22903(회의 받아쓰기)의
 * 구성과 글자 크기·색 토큰을 옮겼다. 내용은 화면마다 다른 고정 예시를 넘겨받는다.
 */

export function AgentHeader({ title, tab }: { title: string; tab: "chat" | "task" }) {
  return (
    <div className={styles["agent-header"]}>
      <span className={styles["agent-session"]}>
        {title}
        <SidebarWorkspaceChevronIcon />
      </span>
      <span className={styles["agent-tabs"]}>
        <span className={cx(tab === "chat" && styles["is-active"])}>채팅</span>
        <span className={cx(tab === "task" && styles["is-active"])}>작업</span>
      </span>
      <SvgIcon src={sidebarToggleIcon} className={base["sidebar-toggle"]} />
    </div>
  );
}

export function AgentComposer({ placeholder, children }: { placeholder: string; children?: ReactNode }) {
  return (
    <div className={styles["composer"]}>
      {children ?? <p className={styles["composer-placeholder"]}>{placeholder}</p>}
      <p className={styles["composer-footer"]}>
        <span>Claude · 웹 서칭</span>
        <span className={styles["composer-actions"]}>
          <span className={styles["composer-voice"]}>
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className={styles["composer-send"]}>↑</span>
        </span>
      </p>
    </div>
  );
}

/** 근거 번호 [n]. isActive면 원문 미리보기가 열린 상태로 강조한다. */
export function Citation({ n, isActive = false }: { n: number; isActive?: boolean }) {
  return <span className={cx(styles["citation"], isActive && styles["is-active"])}>[{n}]</span>;
}

export type StepState = "done" | "running" | "waiting";

export interface ChatThreadData {
  readonly question: string;
  readonly steps?: readonly { label: string; state: StepState }[];
  readonly found?: readonly string[];
  readonly answer: ReactNode;
}

/** 채팅 탭 본문: 질문 → 실행 단계 → 찾은 자료 → 근거 답변 (Figma 1540:19718) */
export function ChatThread({ data }: { data: ChatThreadData }) {
  return (
    <div className={styles["agent-body"]}>
      <p className={styles["bubble"]} data-align="end">
        {data.question}
      </p>
      {data.steps ? (
        <div className={styles["process"]}>
          <p className={styles["agent-caption"]}>실행 단계 ⌄</p>
          <ul className={styles["steps"]}>
            {data.steps.map((step) => (
              <li key={step.label} data-state={step.state}>
                {step.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.found ? (
        <div className={styles["found"]}>
          <p className={styles["agent-caption"]}>찾은 자료 {data.found.length}건</p>
          {data.found.map((name) => (
            <p key={name} className={styles["found-link"]}>
              {name}
            </p>
          ))}
        </div>
      ) : null}
      <div className={styles["answer"]}>{data.answer}</div>
    </div>
  );
}

/** 본문에 표시되는 AI 제안 블록과 거절/수락 버튼 (Figma 1571:27625) */
export function SuggestionBlock({ skill, removed, proposed }: { skill: string; removed: string; proposed: string }) {
  return (
    <>
      <p className={styles["editor-removed"]}>{removed}</p>
      <div className={styles["suggestion"]}>
        <p className={styles["suggestion-label"]}>[제안 : {skill}]</p>
        <p className={styles["suggestion-text"]}>{proposed}</p>
        <p className={styles["suggestion-actions"]}>
          <span className={base["button-danger"]}>✕ 거절</span>
          <span className={base["button-primary"]}>✓ 수락</span>
        </p>
      </div>
    </>
  );
}

export { styles as paneStyles };
