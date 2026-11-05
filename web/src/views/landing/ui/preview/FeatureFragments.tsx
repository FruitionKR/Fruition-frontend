import type { ReactNode } from "react";
import { PreviewPanel, PreviewWindow } from "./PreviewFrame";
import { AgentComposer, AgentHeader, ChatThread, Citation, paneStyles } from "./PreviewPanes";
import { MembersPane } from "./PreviewPages";
import { SidebarPanel, type TreeRow } from "./PreviewShell";
import styles from "./Fragments.module.css";

/*
 * 히어로와 함께하기의 앱 화면 조각. 원래 크기를 실제 표시 폭에 가깝게 잡아(1440 기준 축소율 약 0.9~1) 앱 글자가 13px 안팎으로 읽힌다.
 * 색은 현재 테마의 앱 토큰을 따른다.
 * - 히어로: 연구 자료 — 문서 트리(위키 포함) + 문서 + 채팅 근거 답변 (Figma 1571:27625 · 1540:19718)
 * - 함께하기: 멤버 관리 창, 팀 스킬 패널 (Figma 1540:21567 · 1482:9848)
 */

/** 큰 창(main)과 떠 있는 패널(float)을 겹쳐 놓는 무대. */
function Stage({ main, float }: { main: ReactNode; float: ReactNode }) {
  return (
    <div className={styles["stage"]}>
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
    <PreviewWindow frameClassName={styles["hero-frame"]}>
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

const TEAM_SKILLS = [
  { command: "/meeting-summary", description: "회의록 정리" },
  { command: "/weekly-report", description: "주간 보고 초안" },
  { command: "/file-organize", description: "폴더 정리" }
] as const;

export function TogetherVisual() {
  return (
    <Stage
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
