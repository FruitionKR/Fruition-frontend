import Link from "next/link";
import { cx } from "@/shared/lib/classNames";
import { LANDING_CHAPTERS, LANDING_FAQ, type LandingChapter } from "../model/landingContent";
import {
  CapturePreview,
  ChatTabPreview,
  ConnectPreview,
  TaskTabPreview,
  TogetherPreview
} from "./preview/FeatureFragments";
import styles from "./LandingPage.module.css";
import sections from "./LandingSections.module.css";

/** 장 목차: 01 모으고 쓰기 → 02 지식으로 연결 → 03 활용 → 04 팀으로 확장 */
export function ChapterIndex() {
  return (
    <nav className={sections["chapter-index"]} aria-label="장 목차">
      <ol>
        {LANDING_CHAPTERS.map((chapter) => (
          <li key={chapter.id}>
            <a href={`#${chapter.id}`}>
              <span className={sections["chapter-index-number"]}>{chapter.index}</span>
              {chapter.indexLabel}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ChapterVisual({ id }: { id: LandingChapter["id"] }) {
  switch (id) {
    case "capture":
      return <CapturePreview />;
    case "connect":
      return <ConnectPreview />;
    case "discover":
      return (
        <div className={sections["tab-previews"]}>
          <figure>
            <ChatTabPreview />
            <figcaption>
              <strong>채팅 탭</strong> 질문하고 근거와 함께 답을 받습니다
            </figcaption>
          </figure>
          <figure>
            <TaskTabPreview />
            <figcaption>
              <strong>작업 탭</strong> 편집 · 정리 · 스킬 실행을 확인하고 승인합니다
            </figcaption>
          </figure>
        </div>
      );
    case "together":
      return <TogetherPreview />;
  }
}

function ChapterSection({ chapter }: { chapter: LandingChapter }) {
  const headingId = `${chapter.id}-title`;
  return (
    <section
      id={chapter.id}
      className={cx(sections["chapter"], chapter.visualSide === "left" && sections["is-visual-left"])}
      aria-labelledby={headingId}
    >
      <div className={sections["chapter-copy"]}>
        <p className={sections["chapter-name"]}>
          <span className={sections["chapter-number"]}>{chapter.index}.</span>
          {chapter.name}
          <span className={sections["chapter-english"]}>({chapter.english})</span>
        </p>
        <h2 id={headingId} className={styles["h2"]}>
          {chapter.headline}
        </h2>
        <p className={sections["chapter-note"]}>({chapter.headlineNote})</p>
        <p className={styles["lead"]}>{chapter.body}</p>
        <ul className={sections["chips"]} aria-label={`${chapter.name} 기능`}>
          {chapter.chips.map((chip) => (
            <li key={chip}>{chip}</li>
          ))}
        </ul>
      </div>
      <div className={sections["chapter-visual"]}>
        <ChapterVisual id={chapter.id} />
      </div>
    </section>
  );
}

export function LandingChapters() {
  return (
    <div className={sections["chapters"]}>
      {LANDING_CHAPTERS.map((chapter) => (
        <ChapterSection key={chapter.id} chapter={chapter} />
      ))}
    </div>
  );
}

export function LandingFaq() {
  return (
    <section id="faq" className={sections["faq"]} aria-labelledby="faq-title">
      <h2 id="faq-title" className={styles["h2"]}>
        자주 묻는 질문
      </h2>
      <div className={sections["faq-list"]}>
        {LANDING_FAQ.map((item) => (
          <details key={item.question} className={sections["faq-item"]}>
            <summary>
              <span>{item.question}</span>
              <span className={sections["faq-icon"]} aria-hidden="true" />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function LandingStart() {
  return (
    <section id="start" className={sections["start"]} aria-labelledby="start-title">
      <h2 id="start-title" className={styles["h2"]}>
        지금 기록을 지식으로 바꿔 보세요
      </h2>
      <Link className={styles["button-primary"]} href="/login">
        시작하기
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
