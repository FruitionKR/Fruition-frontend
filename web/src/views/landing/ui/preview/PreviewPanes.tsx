import { cx } from "@/shared/lib/classNames";
import { sidebarToggleIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { SidebarWorkspaceChevronIcon } from "@/widgets/document-sidebar/ui/SidebarIcons";
import base from "./Preview.module.css";
import styles from "./PreviewPanes.module.css";

/*
 * 문서 편집기와 Agent 패널 미리보기. Figma 1571:27625(편집기 · 작업 탭), 1540:19718(채팅 · 근거 답변),
 * 1540:22903(회의 받아쓰기)의 구성과 글자 크기·색 토큰을 그대로 옮겼다. 내용은 고정 예시다.
 */

const DOC_TITLE = "아동의 정서 발달과 또래 관계의 상관관계";
const RESEARCH_QUESTION = "아동의 정서 발달은 또래와의 관계 형성 및 사회적 상호작용에 어떤 영향을 미치는가?";

export function EditorPane({ variant }: { variant: "citations" | "suggestion" }) {
  return (
    <article className={styles["editor"]}>
      <header className={styles["editor-title-row"]}>
        <h1 className={styles["editor-title"]}>{DOC_TITLE}</h1>
        {variant === "suggestion" ? <span className={styles["editor-pending"]}>! 제안 1건 진행 중</span> : null}
      </header>
      <blockquote className={styles["editor-quote"]}>
        <p>
          {RESEARCH_QUESTION} <span className={styles["citation"]}>[1]</span>
        </p>
        <p>
          또래 관계의 질은 정서 조절 능력과 함께 발달한다는 연구가 많다. <span className={styles["citation"]}>[2]</span>
        </p>
      </blockquote>
      <h2 className={styles["editor-h2"]}>📌 연구 개요</h2>
      {variant === "suggestion" ? (
        <>
          <p className={styles["editor-removed"]}>
            아동기는 정서 조절 능력과 사회적 관계 형성 능력이 발달하는 중요한 시기이다. 특히 또래 관계는 아동이 자신의 감정을
            이해하고 표현하는 방법을 학습하는 주요한 사회적 환경으로 작용한다.
          </p>
          <div className={styles["suggestion"]}>
            <p className={styles["suggestion-label"]}>[제안 : /research-summary]</p>
            <p className={styles["suggestion-text"]}>
              아동기 또래 관계는 정서 조절과 감정 표현을 배우는 핵심 환경이며, 두 요소는 서로를 강화한다.
            </p>
            <p className={styles["suggestion-actions"]}>
              <span className={base["button-danger"]}>✕ 거절</span>
              <span className={base["button-primary"]}>✓ 수락</span>
            </p>
          </div>
        </>
      ) : (
        <p className={styles["editor-body"]}>
          아동기는 정서 조절 능력과 사회적 관계 형성 능력이 발달하는 중요한 시기이다. 특히 또래 관계는 아동이 자신의 감정을
          이해하고 표현하는 방법을 학습하는 주요한 사회적 환경으로 작용한다.
        </p>
      )}
      <p className={styles["editor-label"]}>상세 설명</p>
      <ol className={styles["editor-list"]}>
        <li>정서 조절 능력이 높은 아동은 또래와 갈등을 더 원만하게 해결한다.</li>
        <li>긍정적인 또래 경험은 자기 효능감과 사회적 기술을 높인다.</li>
      </ol>
      <p className={styles["editor-label"]}>관련 자료</p>
      <p className={styles["editor-link"]}>또래관계_종단연구.pdf</p>
      <p className={styles["editor-link"]}>정서발달_보고서.pdf</p>
    </article>
  );
}

function AgentHeader({ title, tab }: { title: string; tab: "chat" | "task" }) {
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

function AgentComposer({ placeholder }: { placeholder: string }) {
  return (
    <div className={styles["composer"]}>
      <p className={styles["composer-placeholder"]}>{placeholder}</p>
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

const STEPS = [
  { label: "업로드된 문서 12건 스캔 완료", state: "done" },
  { label: "'또래 관계' 관련 페이지 8건 추출", state: "done" },
  { label: "정서 발달 연관 논문 분석 중", state: "running" },
  { label: "발표용 핵심 자료 정리", state: "waiting" }
] as const;

/** 채팅 탭: 질문 → 실행 단계 → 찾은 자료 → 근거 있는 답변 (Figma 1540:19718) */
export function ChatPanel() {
  return (
    <section className={styles["agent"]}>
      <AgentHeader title="이번 학기 발표 준비" tab="chat" />
      <div className={styles["agent-body"]}>
        <p className={styles["bubble"]}>
          이번 학기 &apos;장애 아동 통합 교육&apos; 발표를 준비 중이야. 또래 관계가 정서 발달에 미치는 영향에 관한 자료랑 논문 좀
          찾아줄래?
        </p>
        <div className={styles["process"]}>
          <p className={styles["agent-caption"]}>서치 명령 실행 중 ⌄</p>
          <ul className={styles["steps"]}>
            {STEPS.map((step) => (
              <li key={step.label} data-state={step.state}>
                {step.label}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles["found"]}>
          <p className={styles["agent-caption"]}>찾은 자료 2건</p>
          <p className={styles["found-link"]}>또래관계_종단연구.pdf</p>
          <p className={styles["found-link"]}>정서발달_보고서.pdf</p>
        </div>
        <div className={styles["answer"]}>
          <p className={styles["agent-caption"]}>실행 중 발견 사항 ⌄</p>
          <p>
            두 자료 모두 또래 관계의 질이 정서 조절 능력과 함께 발달한다고 봅니다. 특히 종단 연구에서는 긍정적인 또래 경험이 이후
            사회적 기술과 자기 효능감을 높였다고 보고합니다. <span className={styles["citation"]}>[1]</span>
            <span className={styles["citation"]}>[2]</span>
          </p>
        </div>
        <p className={styles["bubble"]} data-align="end">
          발표 자료 초안 바로 만들어줘
        </p>
        <p className={styles["typing"]}>
          <span className={styles["typing-dots"]}>•••</span>답변을 작성하고 있어요…
        </p>
      </div>
      <AgentComposer placeholder="AI 에이전트에게 무엇이든 물어보세요." />
    </section>
  );
}

/** 작업 탭: AI 제안 확인 카드와 완료 기록 (Figma 1571:27625 오른쪽 패널) */
export function TaskPanel() {
  return (
    <section className={styles["agent"]}>
      <AgentHeader title="이번 학기 발표 준비" tab="task" />
      <div className={styles["agent-body"]}>
        <p className={styles["agent-caption"]}>확인 필요</p>
        <div className={styles["task-card"]}>
          <p className={styles["task-meta"]}>
            <span>⚡ 문서 : /research-summary</span>
            <span>방금 전</span>
          </p>
          <p className={styles["task-title"]}>&quot;연구 개요를 핵심만 3문장으로 정리해줘&quot;</p>
          <p className={styles["task-desc"]}>{DOC_TITLE} • 연구 개요 • 제안 1개 (본문에 표시)</p>
          <p className={styles["suggestion-actions"]}>
            <span className={base["button-danger"]}>✕ 거절</span>
            <span className={base["button-primary"]}>✓ 수락</span>
          </p>
        </div>
        <p className={styles["task-chips"]}>
          <span>⚡ 더 짧게</span>
          <span>⚡ 이 요청을 스킬로 저장</span>
        </p>
        <p className={styles["agent-caption"]}>완료</p>
        <p className={styles["task-done"]}>
          <span>⚡ 문서 : /file-organize · 프로젝트 타임라인 폴더</span>
          <span>저장됨(5)</span>
        </p>
        <p className={styles["task-note"]}>작업기록은 LLM Wiki에 들어가지 않습니다. 문서·파일의 변경 이력으로만 남습니다.</p>
      </div>
      <AgentComposer placeholder="이 작업에 추가 요청하기 (/스킬 · @문서)" />
    </section>
  );
}

const DICTATION_LINES = [
  "### 주요 논의",
  "- 회원가입과 로그인 기능 구현을 완료했습니다.",
  "- 온보딩 화면 디자인과 개발 전달을 마쳤습니다.",
  "### 결정 사항",
  "- 초기 베타 사용자는 50명으로 제한합니다.",
  "- 전체 테스트는 9월 21일 오후 2시에 진행합니다.",
  "### 해야 할 일",
  "- [ ] 모바일 온보딩 버튼 잘림 수정 · 9월 17일까지",
  "- [ ] 베타 사용자 초대 명단 정리 · 9월 18일까지"
];

/** 회의 받아쓰기: 받아쓰는 중인 회의록 초안 (Figma 1540:22903) */
export function DictationPanel() {
  return (
    <section className={styles["agent"]}>
      <AgentHeader title="주간 회의" tab="chat" />
      <div className={styles["agent-body"]} data-align="start">
        <p className={styles["agent-caption"]}>
          <span className={styles["recording-dot"]} />
          받아쓰는 중 ⌄
        </p>
        <pre className={styles["dictation"]}>{DICTATION_LINES.join("\n")}</pre>
        <p className={styles["typing"]}>
          <span className={styles["typing-dots"]}>•••</span>답변을 작성하고 있어요…
        </p>
      </div>
      <AgentComposer placeholder="AI 에이전트에게 무엇이든 물어보세요." />
    </section>
  );
}
