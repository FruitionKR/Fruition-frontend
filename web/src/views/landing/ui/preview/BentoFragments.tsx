import type { ReactElement } from "react";
import type { LandingBentoItem } from "../../model/landingContent";
import { PreviewFrame } from "./PreviewFrame";
import { AgentComposer, AgentHeader, paneStyles, SuggestionBlock } from "./PreviewPanes";
import base from "./Preview.module.css";
import styles from "./Fragments.module.css";

/*
 * 기능 묶음(벤토) 카드의 앱 화면 조각. 카드마다 다른 예시 자료를 쓴다.
 * 승인 편집(주간 보고서) · 스킬 메뉴 · 회의 받아쓰기(디자인 리뷰) · 위키 점검 제안 · 작업 이력과 롤백.
 */

function ApproveFragment() {
  return (
    <div className={styles["card-doc"]}>
      <p className={styles["doc-crumb"]}>팀 문서 / 10월 3주차 주간 보고</p>
      <h2 className={styles["doc-h2"]}>이번 주 진행 상황</h2>
      <SuggestionBlock
        skill="/weekly-report"
        removed="온보딩 화면 작업은 디자인과 개발이 모두 진행 중이며 다음 주에 마무리될 예정이다."
        proposed="온보딩 화면은 디자인을 마쳤고, 개발은 버튼 잘림 수정만 남았습니다(목요일 완료 예정)."
      />
    </div>
  );
}

const SKILLS = [
  { command: "/meeting-summary", description: "회의록을 정해진 형식으로 정리", scope: "팀" },
  { command: "/weekly-report", description: "이번 주 문서로 주간 보고 초안 작성", scope: "팀" },
  { command: "/translate-en", description: "선택한 문단을 영어로 번역", scope: "개인" }
] as const;

function SkillsFragment() {
  return (
    <section className={paneStyles["agent"]} data-width="fill" data-compact>
      <div className={styles["slash-menu"]}>
        <p className={paneStyles["agent-caption"]}>스킬</p>
        <ul>
          {SKILLS.map((skill, index) => (
            <li key={skill.command} data-active={index === 0 || undefined}>
              <span className={styles["slash-command"]}>{skill.command}</span>
              <span className={styles["slash-desc"]}>{skill.description}</span>
              <span className={styles["slash-scope"]}>{skill.scope}</span>
            </li>
          ))}
        </ul>
      </div>
      <AgentComposer placeholder="">
        <p className={styles["slash-input"]}>
          /<span className={styles["caret"]} />
        </p>
      </AgentComposer>
    </section>
  );
}

const TRANSCRIPT = [
  { speaker: "이서연", text: "첫 화면 안내 문구는 세 단계로 줄이는 게 좋겠어요." },
  { speaker: "최도윤", text: "버튼 잘림은 목요일까지 고칠게요." },
  { speaker: "이서연", text: "그럼 베타 초대는 다음 주 월요일에 보내죠." }
] as const;

function DictationFragment() {
  return (
    <section className={paneStyles["agent"]} data-width="fill" data-compact>
      <AgentHeader title="디자인 리뷰" tab="chat" />
      <div className={styles["dictation"]}>
        <p className={styles["recording"]}>
          <span className={styles["recording-dot"]} />
          받아쓰는 중 · 12:04
          <span className={styles["wave"]}>
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </p>
        <ul className={styles["transcript"]}>
          {TRANSCRIPT.map((line) => (
            <li key={line.text}>
              <strong>{line.speaker}</strong>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const LINT_SUGGESTIONS = [
  { title: "‘첫 사용 경험’과 ‘온보딩’ 페이지 합치기", detail: "같은 내용을 다루는 개념 페이지 2개" },
  { title: "‘가격 정책’에 출처 연결하기", detail: "근거 문서가 없는 문장 3개" },
  { title: "끊긴 연결 정리하기", detail: "삭제된 문서를 가리키는 링크 2개" }
] as const;

function LintFragment() {
  return (
    <div className={styles["lint"]}>
      <p className={styles["lint-head"]}>
        위키 점검 제안 <span>3건</span>
      </p>
      <ul>
        {LINT_SUGGESTIONS.map((item) => (
          <li key={item.title}>
            <span className={styles["lint-text"]}>
              <strong>{item.title}</strong>
              {item.detail}
            </span>
            <span className={base["button-primary"]}>수락</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const HISTORY = [
  { action: "위키 편입", target: "고객 인터뷰 5건", time: "방금 전", state: "rollback" },
  { action: "위키 점검", target: "개념 페이지 2개 수정", time: "10분 전", state: "rollback" },
  { action: "문서 편집", target: "10월 3주차 주간 보고", time: "어제", state: "reverted" }
] as const;

function HistoryFragment() {
  return (
    <div className={styles["history"]}>
      <ul>
        {HISTORY.map((item) => (
          <li key={item.target}>
            <span className={styles["history-dot"]} data-state={item.state} />
            <span className={styles["history-text"]}>
              <strong>{item.action}</strong>
              {item.target}
            </span>
            <span className={styles["history-time"]}>{item.time}</span>
            {item.state === "rollback" ? (
              <span className={styles["history-action"]}>롤백</span>
            ) : (
              <span className={styles["history-done"]}>되돌림</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const FRAGMENTS: Record<LandingBentoItem["id"], { width: number; height: number; render: () => ReactElement }> = {
  approve: { width: 760, height: 300, render: ApproveFragment },
  skills: { width: 400, height: 280, render: SkillsFragment },
  dictation: { width: 400, height: 280, render: DictationFragment },
  lint: { width: 400, height: 280, render: LintFragment },
  history: { width: 400, height: 280, render: HistoryFragment }
};

export function BentoPreview({ id }: { id: LandingBentoItem["id"] }) {
  const { width, height, render: Fragment } = FRAGMENTS[id];
  return (
    <PreviewFrame width={width} height={height} className={styles["bento-frame"]}>
      <Fragment />
    </PreviewFrame>
  );
}
