import Link from "next/link";
import { LegalFooter } from "@/shared/ui/LegalFooter";
import { RailLogoIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { LANDING_NAV } from "../model/landingContent";
import { LandingRedirect } from "./LandingRedirect";
import { ChapterCards, LandingChapters, LandingFaq, LandingStart } from "./LandingSections";
import { SectionTabs } from "./SectionTabs";
import { HeroPreview } from "./preview/FeatureFragments";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./LandingPage.module.css";

/** /home 레일과 같은 로고(RailLogoIcon, 색은 --color-foreground)에 서비스 이름을 붙인다. */
function BrandMark() {
  return (
    <>
      <span className={styles["brand-mark"]}>
        <RailLogoIcon />
      </span>
      <span className={styles["brand-word"]}>Fruition</span>
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
            {LANDING_NAV.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles["header-actions"]}>
          <ThemeSwitch />
          <Link className={styles["login-link"]} href="/login">
            로그인
          </Link>
        </div>
      </div>
    </header>
  );
}

function LandingHero() {
  return (
    <section id="top" className={styles["hero"]} aria-labelledby="landing-title">
      <div className={styles["hero-copy"]}>
        <h1 id="landing-title" className={styles["h1"]}>
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
            기능 둘러보기
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
      <figure className={styles["hero-visual"]}>
        <HeroPreview />
        <figcaption>문서와 위키, 채팅을 한 화면에서. 화면은 예시입니다.</figcaption>
      </figure>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className={styles["landing-page"]}>
      <LandingRedirect />
      <a className={styles["skip-link"]} href="#capture">
        본문으로 건너뛰기
      </a>
      <LandingHeader />
      <main>
        <LandingHero />
        <ChapterCards />
        <SectionTabs />
        <LandingChapters />
        <LandingFaq />
        <LandingStart />
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
