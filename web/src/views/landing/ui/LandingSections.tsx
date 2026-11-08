import Link from "next/link";
import { useTranslations } from "next-intl";
import { cx } from "@/shared/lib/classNames";
import { chevronDownSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { DATA_HANDLING_GROUPS } from "../model/dataHandlingContent";
import { LANDING_DEMO_SLOTS, LANDING_FAQ, LANDING_TOGETHER, type LandingChipId, type LandingDemoSlot } from "../model/landingContent";
import { LANDING_VIDEOS } from "../model/landingVideos";
import { CHIP_ICONS } from "./LandingIcons";
import { LandingVideo } from "./LandingVideo";
import { TogetherVisual } from "./preview/FeatureFragments";
import styles from "./LandingPage.module.css";
import sections from "./LandingSections.module.css";

export function LandingProblems() {
  const t = useTranslations("landing.problems");
  return (
    <section id="problems" className={sections["story"]} aria-labelledby="problems-title">
      <div className={sections["story-heading"]}>
        <p className={sections["story-label"]}>{t("label")}</p>
        <h2 id="problems-title" className={styles["h2"]}>{t("title")}</h2>
        <p className={styles["lead"]}>{t("body")}</p>
      </div>
      <ul className={sections["problem-list"]}>
        <li>
          <h3>{t("findTitle")}</h3>
          <p>{t("findBody")}</p>
        </li>
        <li>
          <h3>{t("connectTitle")}</h3>
          <p>{t("connectBody")}</p>
        </li>
        <li>
          <h3>{t("reuseTitle")}</h3>
          <p>{t("reuseBody")}</p>
        </li>
      </ul>
    </section>
  );
}

export function LandingSolution() {
  const t = useTranslations("landing.solution");
  return (
    <section id="solution" className={sections["solution"]} aria-labelledby="solution-title">
      <div className={sections["story"]}>
        <div className={sections["story-heading"]}>
          <p className={sections["story-label"]}>{t("label")}</p>
          <h2 id="solution-title" className={styles["h2"]}>{t("title")}</h2>
          <p className={styles["lead"]}>{t("body")}</p>
        </div>
        <ol className={sections["solution-list"]}>
          <li>
            <span className={sections["story-number"]} aria-hidden="true">01</span>
            <div><h3>{t("findTitle")}</h3><p>{t("findBody")}</p></div>
          </li>
          <li>
            <span className={sections["story-number"]} aria-hidden="true">02</span>
            <div><h3>{t("connectTitle")}</h3><p>{t("connectBody")}</p></div>
          </li>
          <li>
            <span className={sections["story-number"]} aria-hidden="true">03</span>
            <div><h3>{t("reuseTitle")}</h3><p>{t("reuseBody")}</p></div>
          </li>
        </ol>
        <Link className={styles["button-ghost"]} href="#demo" replace>
          {t("explore")} <span aria-hidden="true">↓</span>
        </Link>
      </div>
    </section>
  );
}

function FeatureChips({ chips, label }: { chips: readonly LandingChipId[]; label: string }) {
  const t = useTranslations("landing.chips");
  return (
    <ul className={sections["chips"]} aria-label={label}>
      {chips.map((chip) => (
        <li key={chip}>
          <span className={sections["chip-icon"]} aria-hidden="true">
            {CHIP_ICONS[chip]}
          </span>
          {t(chip)}
        </li>
      ))}
    </ul>
  );
}

/** 영상으로 다루지 않는 협업 소개: 문구와 멤버·팀 스킬 화면 */
export function LandingTogether() {
  const t = useTranslations("landing");
  return (
    <section id="together" className={sections["together"]} aria-labelledby="together-title">
      <div className={sections["together-inner"]}>
        <div className={sections["together-copy"]}>
          <p className={sections["together-name"]}>
            {t("together.name")}
            <span className={sections["together-english"]}>({LANDING_TOGETHER.english})</span>
          </p>
          <h2 id="together-title" className={styles["h2"]}>
            {t("together.title")}
          </h2>
          <p className={sections["together-note"]}>{t("together.headline")}</p>
          <p className={styles["lead"]}>{t("together.body")}</p>
          <FeatureChips chips={LANDING_TOGETHER.chips} label={t("demo.features", { title: t("together.name") })} />
        </div>
        <div className={sections["together-visual"]}>
          <TogetherVisual />
        </div>
      </div>
    </section>
  );
}

/** 시연 묶음 하나. 영상마다 제목과 틀이 메뉴 아래에 잠시 머무르고, 넓은 화면에서는 묶음 설명도 왼쪽에 함께 머무른다. */
function DemoSlot({ slot }: { slot: LandingDemoSlot }) {
  const t = useTranslations("landing");
  const title = t(`demo.slots.${slot.id}.title`);
  return (
    <li id={`demo-${slot.id}`} className={sections["demo-slot"]}>
      <div className={sections["demo-copy"]}>
        <span className={sections["demo-number"]}>{slot.index}</span>
        <p className={sections["card-english"]}>{slot.english}</p>
        <h3 className={sections["demo-title"]}>{title}</h3>
        <p className={sections["demo-body"]}>{t(`demo.slots.${slot.id}.body`)}</p>
        {slot.chips.length > 0 && <FeatureChips chips={slot.chips} label={t("demo.features", { title })} />}
      </div>
      <div className={sections["demo-steps"]}>
        {slot.steps.map((videoId) => (
          <div key={videoId} className={sections["demo-step"]}>
            <figure className={sections["demo-step-figure"]}>
              <figcaption className={sections["demo-step-copy"]}>
                <h4 className={sections["demo-step-title"]}>{t(`videos.${videoId}.title`)}</h4>
                <p className={sections["demo-body"]}>{t(`videos.${videoId}.body`)}</p>
              </figcaption>
              <LandingVideo video={LANDING_VIDEOS[videoId]} label={t(`videos.${videoId}.label`)} />
            </figure>
          </div>
        ))}
      </div>
    </li>
  );
}

/** 올리기 → 편입·질의 → AI 편집·스킬 흐름을 시연 영상으로 보여 준다. */
export function LandingDemo() {
  const t = useTranslations("landing.demo");
  return (
    <section id="demo" className={cx(styles["hero-backdrop"], styles["demo-backdrop"])} aria-labelledby="demo-title">
      <div className={sections["demo-inner"]}>
        <h2 id="demo-title" className={cx(styles["h2"], sections["demo-head"])}>
          {t("title")}
        </h2>
        <ol className={sections["demo-list"]}>
          {LANDING_DEMO_SLOTS.map((slot) => (
            <DemoSlot key={slot.id} slot={slot} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/** 문서 보관·접근·AI 처리·삭제 방식. 근거는 dataHandlingContent.ts, 문구는 landing.dataHandling 메시지에 있다. */
export function LandingDataHandling() {
  const t = useTranslations("landing");
  return (
    <section id="data-handling" className={sections["data-handling"]} aria-labelledby="data-handling-title">
      <h2 id="data-handling-title" className={styles["h2"]}>
        {t("nav.dataHandling")}
      </h2>
      <div className={sections["data-handling-grid"]}>
        {DATA_HANDLING_GROUPS.map((group) => (
          <article key={group.id} className={sections["data-handling-group"]} aria-labelledby={`data-handling-${group.id}`}>
            <div className={sections["data-handling-group-head"]}>
              <p className={sections["card-english"]}>
                {group.english} · {t(`dataHandling.groups.${group.id}.title`)}
              </p>
              <h3 id={`data-handling-${group.id}`} className={sections["data-handling-group-title"]}>
                {t(`dataHandling.groups.${group.id}.headline`)}
              </h3>
            </div>
            <ul className={sections["data-handling-list"]}>
              {group.items.map((item) => (
                <li key={item}>{t(`dataHandling.items.${item}`)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function LandingFaq() {
  const t = useTranslations("landing.faq");
  return (
    <section id="faq" className={sections["faq"]} aria-labelledby="faq-title">
      <h2 id="faq-title" className={styles["h2"]}>
        {t("title")}
      </h2>
      <div className={sections["faq-list"]}>
        {LANDING_FAQ.map((item) => (
          <details key={item} className={sections["faq-item"]}>
            <summary>
              <span>{t(`items.${item}.question`)}</span>
              <span className={sections["faq-icon"]} aria-hidden="true">
                <SvgIcon src={chevronDownSmallIcon} className={sections["faq-chevron"]} />
              </span>
            </summary>
            <p>{t(`items.${item}.answer`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** 마지막 안내: 히어로와 같은 바탕(그라데이션 + 격자)을 깐 둥근 상자 */
export function LandingStart() {
  const t = useTranslations("landing");
  return (
    <section id="start" className={sections["start"]} aria-labelledby="start-title">
      <div className={cx(sections["start-box"], styles["hero-backdrop"])}>
        <h2 id="start-title" className={styles["h2"]}>
          {t("start.title")}
        </h2>
        <Link className={styles["button-primary"]} href="/login">
          {t("actions.start")}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
