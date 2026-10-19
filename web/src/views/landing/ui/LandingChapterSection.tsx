import type { LandingChapter } from "../model/landingContent";
import { ChapterPreview, DiscoverDemo } from "./preview/LandingPreviews";
import styles from "./LandingPage.module.css";
import chapterStyles from "./LandingChapterSection.module.css";

function ChapterShowcase({ chapter }: { chapter: LandingChapter }) {
  const { showcase } = chapter;

  // 활용 장은 예시 답변을 탭으로 바꿔 보는 데모라 설명 열 없이 넓게 쓴다.
  if (chapter.id === "discover") {
    return (
      <div className={chapterStyles["showcase"]} data-layout="wide">
        <DiscoverDemo />
        <p className={chapterStyles["showcase-note"]}>{showcase.caption}</p>
      </div>
    );
  }

  return (
    <div className={chapterStyles["showcase"]}>
      <div className={chapterStyles["showcase-copy"]}>
        <p className={styles["kicker"]}>{showcase.kicker}</p>
        <p className={chapterStyles["showcase-title"]}>
          {showcase.title[0]}
          <br />
          {showcase.title[1]}
        </p>
        <p className={chapterStyles["showcase-caption"]}>{showcase.caption}</p>
      </div>
      <div className={chapterStyles["showcase-visual"]}>
        <ChapterPreview id={chapter.id} />
      </div>
    </div>
  );
}

export function LandingChapterSection({ chapter }: { chapter: LandingChapter }) {
  const headingId = `${chapter.id}-title`;

  return (
    <section id={chapter.id} className={chapterStyles["chapter"]} aria-labelledby={headingId}>
      <header className={chapterStyles["chapter-header"]}>
        <p className={chapterStyles["chapter-badge"]}>
          <span className={chapterStyles["chapter-number"]}>{chapter.index}</span>
          <span className={styles["kicker"]}>{chapter.kicker}</span>
        </p>
        <h2 id={headingId} className={styles["section-title"]}>
          {chapter.title}
        </h2>
        <p className={chapterStyles["chapter-subtitle"]}>{chapter.subtitle}</p>
        <p className={chapterStyles["chapter-description"]}>{chapter.description}</p>
      </header>
      <ChapterShowcase chapter={chapter} />
      <ul className={chapterStyles["feature-list"]} aria-label={`${chapter.navLabel} 기능`}>
        {chapter.features.map((feature) => (
          <li key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
