import Link from "next/link";
import type { ReactElement } from "react";
import { cx } from "@/shared/lib/classNames";
import { chevronDownSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { LANDING_CHAPTERS, LANDING_FAQ, type LandingChapter } from "../model/landingContent";
import { CHAPTER_ICONS, CHIP_ICONS } from "./LandingIcons";
import { CaptureVisual, ConnectVisual, DiscoverVisual, TogetherVisual } from "./preview/FeatureFragments";
import styles from "./LandingPage.module.css";
import sections from "./LandingSections.module.css";

/** 장 목차 카드: 아이콘 · 번호 · 영어 부제 · 짧은 이름 · 한 줄 설명. 카드 전체가 장으로 가는 링크다. */
export function ChapterCards() {
  return (
    <nav className={sections["chapter-cards"]} aria-label="장 목차">
      <ol>
        {LANDING_CHAPTERS.map((chapter) => (
          <li key={chapter.id}>
            <Link className={sections["chapter-card"]} href={`#${chapter.id}`}>
              <span className={sections["card-top"]}>
                <span className={sections["card-icon"]} aria-hidden="true">
                  {CHAPTER_ICONS[chapter.id]}
                </span>
                <span className={sections["card-number"]}>{chapter.index}</span>
              </span>
              <span className={sections["card-english"]}>{chapter.english}</span>
              <span className={sections["card-title"]}>{chapter.indexLabel}</span>
              <span className={sections["card-summary"]}>{chapter.summary}</span>
              <span className={sections["card-arrow"]} aria-hidden="true">
                ↓
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const CHAPTER_VISUALS: Record<LandingChapter["id"], () => ReactElement> = {
  capture: CaptureVisual,
  connect: ConnectVisual,
  discover: DiscoverVisual,
  together: TogetherVisual
};

function ChapterSection({ chapter }: { chapter: LandingChapter }) {
  const headingId = `${chapter.id}-title`;
  const Visual = CHAPTER_VISUALS[chapter.id];
  return (
    <section
      id={chapter.id}
      className={cx(sections["chapter"], chapter.visualSide === "left" && sections["is-visual-left"])}
      data-chapter={chapter.id}
      aria-labelledby={headingId}
    >
      <div className={sections["chapter-inner"]}>
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
              <li key={chip}>
                <span className={sections["chip-icon"]} aria-hidden="true">
                  {CHIP_ICONS[chip]}
                </span>
                {chip}
              </li>
            ))}
          </ul>
        </div>
        <div className={sections["chapter-visual"]}>
          <Visual />
        </div>
      </div>
    </section>
  );
}

export function LandingChapters() {
  return (
    <div id="chapters" className={sections["chapters"]}>
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
              <span className={sections["faq-icon"]} aria-hidden="true">
                <SvgIcon src={chevronDownSmallIcon} className={sections["faq-chevron"]} />
              </span>
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** 마지막 안내: 히어로와 같은 바탕(그라데이션 + 격자)을 깐 둥근 상자 */
export function LandingStart() {
  return (
    <section id="start" className={sections["start"]} aria-labelledby="start-title">
      <div className={cx(sections["start-box"], styles["hero-backdrop"])}>
        <h2 id="start-title" className={styles["h2"]}>
          지금 기록을 지식으로 바꿔 보세요
        </h2>
        <Link className={styles["button-primary"]} href="/login">
          시작하기
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
