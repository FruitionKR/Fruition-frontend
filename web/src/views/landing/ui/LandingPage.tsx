import Link from "next/link";
import { LegalFooter } from "@/shared/ui/LegalFooter";
import { LANDING_CHAPTERS } from "../model/landingContent";
import { LandingChapterSection } from "./LandingChapterSection";
import { LandingClosing, LandingFlow } from "./LandingClosing";
import { LandingRedirect } from "./LandingRedirect";
import { EditorMock } from "./ProductMocks";
import styles from "./LandingPage.module.css";

function BrandMark() {
  return (
    <>
      <span className={styles["brand-mark"]} aria-hidden="true" />
      <span className={styles["brand-word"]}>
        fruition<span className={styles["brand-dot"]}>.</span>
      </span>
    </>
  );
}

function LandingHeader() {
  return (
    <header className={styles["landing-header"]}>
      <div className={styles["header-inner"]}>
        <a className={styles["brand"]} href="#top" aria-label="Fruition 처음으로">
          <BrandMark />
        </a>
        <nav className={styles["header-nav"]} aria-label="주요 메뉴">
          <ul>
            {LANDING_CHAPTERS.map((chapter) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>{chapter.navLabel}</a>
              </li>
            ))}
          </ul>
        </nav>
        <Link className={styles["login-link"]} href="/login">
          로그인
        </Link>
      </div>
    </header>
  );
}

function LandingHero() {
  return (
    <section id="top" className={styles["hero"]} aria-labelledby="landing-title">
      <p className={styles["eyebrow"]}>
        <span className={styles["eyebrow-dot"]} aria-hidden="true" />
        KNOWLEDGE WORKSPACE
      </p>
      <h1 id="landing-title" className={styles["hero-title"]}>
        쌓이는 기록을,
        <br />
        쓰이는 지식으로.
      </h1>
      <p className={styles["hero-lead"]}>
        흩어진 기록을 하나로 모으고, 연결하고, 활용하세요.{" "}
        <br />
        단순한 문서 저장을 넘어, 기록이 살아 있는 지식으로 발전하는 공간.
      </p>
      <div className={styles["hero-actions"]}>
        <Link className={styles["button-primary"]} href="/login">
          시작하기
          <span aria-hidden="true">→</span>
        </Link>
        <a className={styles["button-ghost"]} href="#capture">
          핵심 기능 살펴보기
          <span aria-hidden="true">↓</span>
        </a>
      </div>
      <ol className={styles["pipeline"]} aria-label="기록이 지식이 되는 과정">
        <li>DOCUMENT</li>
        <li>LLM WIKI</li>
        <li>EVIDENCE</li>
      </ol>
      <figure className={styles["hero-stage"]}>
        <div className={styles["hero-tilt"]}>
          <EditorMock />
        </div>
        <figcaption>Fruition · 제품 화면 구성 예시</figcaption>
      </figure>
      <div className={styles["hero-meta"]}>
        <span>Fruition / Product features</span>
        <span>당신의 기록, 다음 생각의 근거.</span>
      </div>
    </section>
  );
}

function ChapterIndex() {
  return (
    <nav className={styles["chapter-index"]} aria-label="기능 목차">
      <ol>
        {LANDING_CHAPTERS.map((chapter) => (
          <li key={chapter.id}>
            <a href={`#${chapter.id}`}>
              <span className={styles["chapter-index-number"]}>{chapter.index}</span>
              <span className={styles["chapter-index-label"]}>{chapter.indexLabel}</span>
              <span className={styles["chapter-index-arrow"]} aria-hidden="true">
                ↓
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function LandingPage() {
  const [capture, connect, discover, together] = LANDING_CHAPTERS;

  return (
    <div className={styles["landing-page"]}>
      <LandingRedirect />
      <a className={styles["skip-link"]} href="#capture">
        본문으로 건너뛰기
      </a>
      <LandingHeader />
      <main>
        <LandingHero />
        <ChapterIndex />
        <LandingChapterSection chapter={capture} />
        <LandingChapterSection chapter={connect} />
        <LandingChapterSection chapter={discover} />
        <LandingFlow />
        <LandingChapterSection chapter={together} />
        <LandingClosing />
      </main>
      <div className={styles["landing-bottom"]}>
        <footer className={styles["landing-footer"]}>
          <div className={styles["footer-brand"]}>
            <BrandMark />
            <p>쌓이는 기록을, 쓰이는 지식으로.</p>
          </div>
          <p className={styles["footer-copy"]}>© Team Fruition</p>
        </footer>
        {/* 약관·운영자 정보(이슈 #130). 기능 플래그가 꺼져 있으면 아무것도 그리지 않는다. footer 안에 footer를 둘 수 없어 형제로 둔다. */}
        <LegalFooter />
      </div>
    </div>
  );
}
