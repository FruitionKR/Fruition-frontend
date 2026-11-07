import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
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

/** 트리 행 이름은 landing.preview.hero.tree 아래 키다. */
const HERO_ROWS: readonly (Omit<TreeRow, "label"> & { key: "research" | "studyPdf" | "notes" | "wiki" | "emotion" | "study" | "social" })[] = [
  { key: "research", depth: 0, kind: "open-folder" },
  { key: "studyPdf", depth: 1, kind: "file", badge: "PDF" },
  { key: "notes", depth: 1, kind: "file", badge: "MD", isActive: true },
  { key: "wiki", depth: 0, kind: "open-folder" },
  { key: "emotion", depth: 1, kind: "file", wiki: "concept" },
  { key: "study", depth: 1, kind: "file", wiki: "source" },
  { key: "social", depth: 1, kind: "file", wiki: "concept" }
];

export function HeroPreview() {
  const t = useTranslations("landing.preview.hero");
  const rows = HERO_ROWS.map(({ key, ...row }) => ({ ...row, label: t(`tree.${key}`) }));
  return (
    <PreviewWindow frameClassName={styles["hero-frame"]}>
      <div className={styles["app"]}>
        <SidebarPanel rows={rows} />
        <article className={styles["doc"]} data-size="compact">
          <p className={styles["doc-crumb"]}>{t("crumb")}</p>
          <h1 className={styles["doc-title"]}>{t("docTitle")}</h1>
          <p className={styles["doc-text"]}>
            {t.rich("docText", { link: (chunks) => <span className={styles["wiki-link"]}>{chunks}</span> })}
          </p>
          <h2 className={styles["doc-h2"]}>{t("checksTitle")}</h2>
          <ul className={styles["doc-checks"]}>
            <li data-done>{t("checks.sample")}</li>
            <li data-done>{t("checks.scores")}</li>
            <li>{t("checks.figures")}</li>
          </ul>
        </article>
        <section className={paneStyles["agent"]} data-width="hero">
          <AgentHeader title={t("session")} tab="chat" />
          <ChatThread
            data={{
              question: t("question"),
              answer: (
                <>
                  <p>
                    {t("answer1")} <Citation n={1} isActive />
                  </p>
                  <p>
                    {t("answer2")} <Citation n={2} />
                  </p>
                  <ul className={styles["source-list"]}>
                    <li data-active>
                      <span className={styles["source-number"]}>1</span>
                      {t("tree.study")}
                    </li>
                    <li>
                      <span className={styles["source-number"]}>2</span>
                      {t("tree.social")}
                    </li>
                  </ul>
                </>
              )
            }}
          />
          <AgentComposer placeholder={t("composer")} />
        </section>
      </div>
    </PreviewWindow>
  );
}

/** 설명은 landing.preview.skills 아래 키다. */
const TEAM_SKILLS = [
  { command: "/meeting-summary", key: "meetingSummary" },
  { command: "/weekly-report", key: "weeklyReport" },
  { command: "/file-organize", key: "fileOrganize" }
] as const;

export function TogetherVisual() {
  const t = useTranslations("landing.preview.skills");
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
              {t("title")} <span>{TEAM_SKILLS.length}</span>
            </p>
            <ul>
              {TEAM_SKILLS.map((skill) => (
                <li key={skill.command}>
                  <strong>{skill.command}</strong>
                  <span>{t(skill.key)}</span>
                  <em>{t("team")}</em>
                </li>
              ))}
            </ul>
          </div>
        </PreviewPanel>
      }
    />
  );
}
