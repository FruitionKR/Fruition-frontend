import { cx } from "@/shared/lib/classNames";
import type { ReactNode } from "react";
import { PreviewPanel, PreviewWindow } from "./PreviewFrame";
import { AgentComposer, AgentHeader, ChatThread, Citation, paneStyles, SuggestionBlock } from "./PreviewPanes";
import { GraphPane, MembersPane } from "./PreviewPages";
import { SidebarPanel, type TreeRow } from "./PreviewShell";
import base from "./Preview.module.css";
import styles from "./Fragments.module.css";

/*
 * 히어로와 장(01~04)의 앱 화면 조각. 장마다 크게 자른 앱 창 하나 + 창 모서리에 겹쳐 떠 있는 보조 패널 하나로 보여 준다.
 * 원래 크기를 실제 표시 폭에 가깝게 잡아(1440 기준 축소율 약 0.9~1) 앱 글자가 13px 안팎으로 읽힌다.
 * 화면마다 다른 예시 자료를 쓰고, 색은 현재 테마의 앱 토큰을 따른다.
 * - 히어로: 연구 자료 — 문서 트리(위키 포함) + 문서 + 채팅 근거 답변 (Figma 1571:27625 · 1540:19718)
 * - 01 모으고 쓰기: 시장 조사 — 문서 트리 + 변환된 문서 창, 위키 편입 알림 패널
 * - 02 지식으로 연결: 제품 기획 — 위키 그래프 창, 개념 페이지 패널 (Figma 1406:13761)
 * - 03 활용: 고객 인터뷰 — 채팅 탭 근거 답변, 작업 탭 편집 제안 승인 (Figma 1540:19718 · 1571:27625)
 * - 04 팀으로 확장: 멤버 관리 창, 팀 스킬 패널 (Figma 1540:21567 · 1482:9848)
 */

type StageLayout = "capture" | "connect" | "discover" | "together";

/** 큰 창(main)과 떠 있는 패널(float)을 겹쳐 놓는 무대. 패널 위치는 장마다 CSS(data-layout)가 정한다. */
function Stage({ layout, main, float }: { layout: StageLayout; main: ReactNode; float: ReactNode }) {
  return (
    <div className={styles["stage"]} data-layout={layout}>
      <div className={styles["stage-main"]}>{main}</div>
      <div className={styles["stage-float"]}>{float}</div>
    </div>
  );
}

const HERO_ROWS: readonly TreeRow[] = [
  { label: "연구 자료", depth: 0, kind: "open-folder" },
  { label: "또래관계_종단연구.pdf", depth: 1, kind: "file", badge: "PDF" },
  { label: "연구 노트", depth: 1, kind: "file", badge: "MD", isActive: true },
  { label: "위키", depth: 0, kind: "open-folder" },
  { label: "정서 조절", depth: 1, kind: "file", wiki: "concept" },
  { label: "또래 관계 종단 연구", depth: 1, kind: "file", wiki: "source" },
  { label: "사회적 기술", depth: 1, kind: "file", wiki: "concept" }
];

export function HeroPreview() {
  return (
    <PreviewWindow className={styles["hero-window"]} frameClassName={styles["hero-frame"]}>
      <div className={styles["app"]}>
        <SidebarPanel rows={HERO_ROWS} />
        <article className={styles["doc"]} data-size="compact">
          <p className={styles["doc-crumb"]}>연구 자료 / 연구 노트</p>
          <h1 className={styles["doc-title"]}>연구 노트</h1>
          <p className={styles["doc-text"]}>
            이번 학기 발표 주제는 <span className={styles["wiki-link"]}>정서 조절</span>과{" "}
            <span className={styles["wiki-link"]}>사회적 기술</span>의 관계다. 근거는{" "}
            <span className={styles["wiki-link"]}>또래 관계 종단 연구</span>에서 가져온다.
          </p>
          <h2 className={styles["doc-h2"]}>확인할 것</h2>
          <ul className={styles["doc-checks"]}>
            <li data-done>종단 연구의 표본 수와 기간</li>
            <li data-done>정서 조절 점수 차이</li>
            <li>발표용 그림 정리</li>
          </ul>
        </article>
        <section className={paneStyles["agent"]} data-width="hero">
          <AgentHeader title="발표 준비" tab="chat" />
          <ChatThread
            data={{
              question: "또래 관계가 정서 조절에 어떤 영향을 줘?",
              answer: (
                <>
                  <p>
                    또래 관계의 질이 높을수록 정서 조절 능력도 함께 발달합니다. <Citation n={1} isActive />
                  </p>
                  <p>
                    갈등을 원만하게 해결한 경험은 이후 사회적 기술을 높였습니다. <Citation n={2} />
                  </p>
                  <ul className={styles["source-list"]}>
                    <li data-active>
                      <span className={styles["source-number"]}>1</span>또래 관계 종단 연구
                    </li>
                    <li>
                      <span className={styles["source-number"]}>2</span>사회적 기술
                    </li>
                  </ul>
                </>
              )
            }}
          />
          <AgentComposer placeholder="AI 에이전트에게 무엇이든 물어보세요." />
        </section>
      </div>
    </PreviewWindow>
  );
}

const UPLOAD_ROWS: readonly TreeRow[] = [
  { label: "시장 조사", depth: 0, kind: "open-folder" },
  { label: "2026_시장보고서.pdf", depth: 1, kind: "file", badge: "PDF" },
  { label: "2026 시장 보고서", depth: 1, kind: "file", badge: "MD", isActive: true },
  { label: "경쟁사 비교표", depth: 1, kind: "file", badge: "MD" },
  { label: "회의록", depth: 0, kind: "open-folder" },
  { label: "10월 2주차 회의", depth: 1, kind: "file", badge: "MD" },
  { label: "투자 자료", depth: 0, kind: "folder" }
];

export function CaptureVisual() {
  return (
    <Stage
      layout="capture"
      main={
        <PreviewWindow width={600} height={400}>
          <div className={styles["app"]}>
            <SidebarPanel rows={UPLOAD_ROWS} />
            <article className={styles["doc"]} data-size="compact">
              <p className={styles["doc-crumb"]}>시장 조사 / 2026 시장 보고서</p>
              <h1 className={styles["doc-title"]}>2026 시장 보고서</h1>
              <p className={styles["doc-meta"]}>PDF에서 변환한 Markdown 문서</p>
              <h2 className={styles["doc-h2"]}>1. 시장 규모</h2>
              <p className={styles["doc-text"]}>국내 협업 도구 시장은 전년 대비 18% 성장했으며, AI 기능을 갖춘 도구의 비중이 빠르게 늘고 있다.</p>
              <table className={styles["doc-table"]}>
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>2025</th>
                    <th>2026</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>AI 도구</td>
                    <td>0.3조</td>
                    <td>0.5조</td>
                  </tr>
                </tbody>
              </table>
            </article>
          </div>
        </PreviewWindow>
      }
      float={
        <PreviewPanel width={280} height={150}>
          <div className={styles["notice"]}>
            <p className={styles["notice-title"]}>문서 변환이 끝났어요</p>
            <p className={styles["notice-text"]}>2026_시장보고서.pdf를 Markdown 문서로 바꿨습니다.</p>
            <p className={styles["notice-actions"]}>
              <span className={styles["notice-secondary"]}>닫기</span>
              <span className={base["button-primary"]} data-size="small">
                위키 편입
              </span>
            </p>
          </div>
        </PreviewPanel>
      }
    />
  );
}

export function ConnectVisual() {
  return (
    <Stage
      layout="connect"
      main={
        <PreviewWindow width={600} height={400}>
          <div className={cx(styles["app"], styles["graph-zoom"])}>
            <GraphPane />
          </div>
        </PreviewWindow>
      }
      float={
        <PreviewPanel width={300} height={250}>
          <div className={styles["wiki-page"]}>
            <p className={styles["wiki-kind"]}>개념 페이지</p>
            <h1 className={styles["wiki-title"]}>첫 사용 경험</h1>
            <p className={styles["doc-text"]}>가입 직후 핵심 기능을 처음 쓰기까지의 과정. 인터뷰와 사용성 테스트에서 반복해서 언급되었다.</p>
            <p className={styles["wiki-section"]}>출처 3</p>
            <ul className={styles["wiki-sources"]}>
              <li>고객 인터뷰 정리</li>
              <li>사용성 테스트 결과</li>
            </ul>
          </div>
        </PreviewPanel>
      }
    />
  );
}

const INTERVIEW_SOURCES = [
  { n: 1, name: "고객 인터뷰 — 디자이너", quote: "가입하고 나서 뭘 먼저 해야 할지 몰랐어요." },
  { n: 2, name: "고객 인터뷰 — 팀장", quote: "팀원 초대 버튼을 한참 찾았습니다." }
] as const;

/** 03 활용: 채팅 탭(질문 → 근거 답변)과 작업 탭(편집 제안 → 승인, 스킬로 저장)을 엇갈려 겹친다. */
export function DiscoverVisual() {
  return (
    <Stage
      layout="discover"
      main={
        <PreviewPanel width={300} height={440}>
          <section className={paneStyles["agent"]} data-width="fill">
            <AgentHeader title="인터뷰 정리" tab="chat" />
            <ChatThread
              data={{
                question: "고객들이 가장 많이 말한 불편은 뭐야?",
                answer: (
                  <>
                    <p>
                      가입 직후 무엇을 해야 할지 모른다는 의견이 가장 많았습니다. <Citation n={1} />
                    </p>
                    <p>
                      다음은 팀원 초대 기능을 찾기 어렵다는 점입니다. <Citation n={2} />
                    </p>
                    <ul className={styles["quote-list"]}>
                      {INTERVIEW_SOURCES.map((source) => (
                        <li key={source.n}>
                          <p className={styles["quote-head"]}>
                            <span className={styles["source-number"]}>{source.n}</span>
                            {source.name}
                          </p>
                          <p className={styles["quote-text"]}>“{source.quote}”</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              }}
            />
          </section>
        </PreviewPanel>
      }
      float={
        <PreviewPanel width={300} height={440}>
          <section className={paneStyles["agent"]} data-width="fill">
            <AgentHeader title="주간 보고 정리" tab="task" />
            <div className={styles["task-body"]}>
              <p className={paneStyles["agent-caption"]}>확인 필요</p>
              <div className={styles["task-card"]}>
                <p className={styles["task-meta"]}>
                  <span>⚡ 문서 : /weekly-report</span>
                  <span>방금 전</span>
                </p>
                <p className={styles["task-title"]}>&quot;이번 주 진행 상황을 줄여줘&quot;</p>
                <SuggestionBlock
                  skill="/weekly-report"
                  removed="온보딩 화면 작업은 디자인과 개발이 모두 진행 중이다."
                  proposed="온보딩 디자인 완료, 개발은 버튼 잘림 수정만 남음."
                />
              </div>
              <p className={styles["task-chips"]}>
                <span>⚡ 더 짧게</span>
                <span>⚡ 이 요청을 스킬로 저장</span>
              </p>
            </div>
          </section>
        </PreviewPanel>
      }
    />
  );
}

const TEAM_SKILLS = [
  { command: "/meeting-summary", description: "회의록 정리" },
  { command: "/weekly-report", description: "주간 보고 초안" },
  { command: "/file-organize", description: "폴더 정리" }
] as const;

export function TogetherVisual() {
  return (
    <Stage
      layout="together"
      main={
        <PreviewWindow width={600} height={380}>
          <div className={styles["team-app"]}>
            <MembersPane />
          </div>
        </PreviewWindow>
      }
      float={
        <PreviewPanel width={280} height={190}>
          <div className={styles["team-skills"]}>
            <p className={styles["team-skills-head"]}>
              팀 스킬 <span>{TEAM_SKILLS.length}</span>
            </p>
            <ul>
              {TEAM_SKILLS.map((skill) => (
                <li key={skill.command}>
                  <strong>{skill.command}</strong>
                  <span>{skill.description}</span>
                  <em>팀</em>
                </li>
              ))}
            </ul>
          </div>
        </PreviewPanel>
      }
    />
  );
}
