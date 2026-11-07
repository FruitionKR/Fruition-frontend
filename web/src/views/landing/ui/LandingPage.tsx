import Link from "next/link";
import { useTranslations } from "next-intl";
import { cx } from "@/shared/lib/classNames";
import { LegalFooter } from "@/shared/ui/LegalFooter";
import { RailLogoIcon } from "@/widgets/rail-navigation/ui/RailIcons";
import { LANDING_FIRST_DEMO_ANCHOR, LANDING_NAV } from "../model/landingContent";
import { LandingRedirect } from "./LandingRedirect";
import { LandingMobileMenu } from "./LandingMobileMenu";
import { LandingDataHandling, LandingDemo, LandingFaq, LandingStart, LandingTogether } from "./LandingSections";
import { HeroPreview } from "./preview/FeatureFragments";
import { LanguageSwitch } from "./LanguageSwitch";
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
  const t = useTranslations("landing");
  return (
    <header className={styles["landing-header"]}>
      <div className={styles["header-inner"]}>
        <Link className={styles["brand"]} href="#top" replace aria-label={t("header.home")}>
          <BrandMark />
        </Link>
        <nav className={styles["header-nav"]} aria-label={t("header.nav")}>
          <ul>
            {LANDING_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} replace>{t(`nav.${item.key}`)}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles["header-actions"]}>
          <LanguageSwitch />
          <ThemeSwitch />
          <Link className={styles["login-link"]} href="/login">
            {t("header.login")}
          </Link>
          <LandingMobileMenu />
        </div>
      </div>
    </header>
  );
}

function LandingHero() {
  const t = useTranslations("landing");
  return (
    <section id="top" className={cx(styles["hero"], styles["hero-backdrop"])} aria-labelledby="landing-title">
      <div className={styles["hero-inner"]}>
        <div className={styles["hero-copy"]}>
          <h1 id="landing-title" className={styles["h1"]}>
            {t("hero.titleLine1")}
            <br />
            {t("hero.titleLine2")}
          </h1>
          <div className={styles["hero-lead"]}>
            <p className={styles["hero-sub"]}>{t("hero.sub")}</p>
            <p className={styles["hero-text"]}>{t("hero.text")}</p>
          </div>
          <div className={styles["hero-actions"]}>
            <Link className={styles["button-primary"]} href="/login">
              {t("actions.start")}
              <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles["button-ghost"]} href={LANDING_FIRST_DEMO_ANCHOR} replace>
              {t("actions.explore")}
              <span aria-hidden="true">↓</span>
            </Link>
          </div>
        </div>
        <figure className={styles["hero-visual"]}>
          <HeroPreview />
          <figcaption>{t("hero.caption")}</figcaption>
        </figure>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const t = useTranslations("landing");
  return (
    <div className={styles["landing-page"]}>
      <LandingRedirect />
      <Link className={styles["skip-link"]} href={LANDING_FIRST_DEMO_ANCHOR} replace>
        {t("skipLink")}
      </Link>
      <LandingHeader />
      <main>
        <LandingHero />
        <LandingDemo />
        <LandingTogether />
        <LandingDataHandling />
        <LandingFaq />
        <LandingStart />
      </main>
      <div className={styles["landing-bottom"]}>
        <div className={styles["landing-bottom-inner"]}>
          <footer className={styles["landing-footer"]}>
            <div className={styles["footer-brand"]}>
              <BrandMark />
              <p>{t("footer.tagline")}</p>
            </div>
            <p className={styles["footer-copy"]}>
              {t("footer.copyright")}
              {/* 기본 언어를 정하는 IP 국가 데이터의 출처 표기(DB-IP Lite, CC BY 4.0). src/shared/i18n/ipCountry.ts */}
              <a className={styles["footer-credit"]} href="https://db-ip.com" target="_blank" rel="noopener noreferrer">
                {t("footer.geoip")}
              </a>
            </p>
          </footer>
          {/* 약관·운영자 정보(이슈 #130). 기능 플래그가 꺼져 있으면 아무것도 그리지 않는다. footer 안에 footer를 둘 수 없어 형제로 둔다. */}
          <LegalFooter />
        </div>
      </div>
    </div>
  );
}
