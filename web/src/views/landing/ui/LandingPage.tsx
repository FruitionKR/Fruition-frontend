import Link from "next/link";
import { LegalFooter } from "@/shared/ui/LegalFooter";
import { RailLogoIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { LANDING_NAV } from "../model/landingContent";
import { LandingFaq, LandingStart, LandingTeam, LandingUseCases } from "./LandingClosing";
import { LandingRedirect } from "./LandingRedirect";
import { LandingBento, LandingFeatures, LandingFlow } from "./LandingSections";
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
          자료를 올리면,
          <br />
          팀의 위키가 됩니다
        </h1>
        <p className={styles["hero-lead"]}>
          논문·회의록·메모를 올리면 개념과 출처가 정리된 위키가 되고, 질문하면 근거와 함께 답합니다.
        </p>
        <div className={styles["hero-actions"]}>
          <Link className={styles["button-primary"]} href="/login">
            시작하기
            <span aria-hidden="true">→</span>
          </Link>
          <a className={styles["button-ghost"]} href="#flow">
            어떻게 동작하나요
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
      <figure className={styles["hero-visual"]}>
        <HeroPreview />
        <figcaption>답변의 근거 [1]을 누르면 원문의 해당 부분이 열립니다. 화면은 예시입니다.</figcaption>
      </figure>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className={styles["landing-page"]}>
      <LandingRedirect />
      <a className={styles["skip-link"]} href="#flow">
        본문으로 건너뛰기
      </a>
      <LandingHeader />
      <main>
        <LandingHero />
        <LandingFlow />
        <LandingFeatures />
        <LandingBento />
        <LandingTeam />
        <LandingUseCases />
        <LandingFaq />
        <LandingStart />
      </main>
      <div className={styles["landing-bottom"]}>
        <footer className={styles["landing-footer"]}>
          <div className={styles["footer-brand"]}>
            <BrandMark />
            <p>자료를 올리면, 팀의 위키가 됩니다.</p>
          </div>
          <p className={styles["footer-copy"]}>© Team Fruition</p>
        </footer>
        {/* 약관·운영자 정보(이슈 #130). 기능 플래그가 꺼져 있으면 아무것도 그리지 않는다. footer 안에 footer를 둘 수 없어 형제로 둔다. */}
        <LegalFooter />
      </div>
    </div>
  );
}
