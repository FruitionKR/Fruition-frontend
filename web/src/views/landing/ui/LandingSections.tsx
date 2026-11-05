import Link from "next/link";
import { cx } from "@/shared/lib/classNames";
import { chevronDownSmallIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { DATA_HANDLING_GROUPS } from "../model/dataHandlingContent";
import { LANDING_DEMO_SLOTS, LANDING_FAQ, LANDING_TOGETHER, landingNavLabel, type LandingDemoSlot } from "../model/landingContent";
import { LANDING_VIDEOS } from "../model/landingVideos";
import { CHIP_ICONS } from "./LandingIcons";
import { LandingVideo } from "./LandingVideo";
import { TogetherVisual } from "./preview/FeatureFragments";
import styles from "./LandingPage.module.css";
import sections from "./LandingSections.module.css";

function FeatureChips({ chips, label }: { chips: readonly string[]; label: string }) {
  return (
    <ul className={sections["chips"]} aria-label={label}>
      {chips.map((chip) => (
        <li key={chip}>
          <span className={sections["chip-icon"]} aria-hidden="true">
            {CHIP_ICONS[chip]}
          </span>
          {chip}
        </li>
      ))}
    </ul>
  );
}

/** 영상으로 다루지 않는 협업 소개: 문구와 멤버·팀 스킬 화면 */
export function LandingTogether() {
  return (
    <section id="together" className={sections["together"]} aria-labelledby="together-title">
      <div className={sections["together-inner"]}>
        <div className={sections["together-copy"]}>
          <p className={sections["together-name"]}>
            {LANDING_TOGETHER.name}
            <span className={sections["together-english"]}>({LANDING_TOGETHER.english})</span>
          </p>
          <h2 id="together-title" className={styles["h2"]}>
            {LANDING_TOGETHER.title}
          </h2>
          <p className={sections["together-note"]}>{LANDING_TOGETHER.headline}</p>
          <p className={styles["lead"]}>{LANDING_TOGETHER.body}</p>
          <FeatureChips chips={LANDING_TOGETHER.chips} label={`${LANDING_TOGETHER.name} 기능`} />
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
  return (
    <li id={`demo-${slot.id}`} className={sections["demo-slot"]}>
      <div className={sections["demo-copy"]}>
        <span className={sections["demo-number"]}>{slot.index}</span>
        <p className={sections["card-english"]}>{slot.english}</p>
        <h3 className={sections["demo-title"]}>{slot.title}</h3>
        <p className={sections["demo-body"]}>{slot.body}</p>
        {slot.chips.length > 0 && <FeatureChips chips={slot.chips} label={`${slot.title} 기능`} />}
      </div>
      <div className={sections["demo-steps"]}>
        {slot.steps.map((step) => (
          <div key={step.videoId} className={sections["demo-step"]}>
            <figure className={sections["demo-step-figure"]}>
              <figcaption className={sections["demo-step-copy"]}>
                <h4 className={sections["demo-step-title"]}>{step.title}</h4>
                <p className={sections["demo-body"]}>{step.body}</p>
              </figcaption>
              <LandingVideo video={LANDING_VIDEOS[step.videoId]} />
            </figure>
          </div>
        ))}
      </div>
    </li>
  );
}

/** 올리기 → 편입·질의 → AI 편집·스킬 흐름을 시연 영상으로 보여 준다. */
export function LandingDemo() {
  return (
    <section id="demo" className={cx(styles["hero-backdrop"], styles["demo-backdrop"])} aria-labelledby="demo-title">
      <div className={sections["demo-inner"]}>
        <h2 id="demo-title" className={cx(styles["h2"], sections["demo-head"])}>
          기록이 지식이 되는 과정
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

/** 문서 보관·접근·AI 처리·삭제 방식. 문구는 근거와 함께 dataHandlingContent.ts에 있다. */
export function LandingDataHandling() {
  return (
    <section id="data-handling" className={sections["data-handling"]} aria-labelledby="data-handling-title">
      <h2 id="data-handling-title" className={styles["h2"]}>
        {landingNavLabel("#data-handling")}
      </h2>
      <div className={sections["data-handling-grid"]}>
        {DATA_HANDLING_GROUPS.map((group) => (
          <article key={group.id} className={sections["data-handling-group"]} aria-labelledby={`data-handling-${group.id}`}>
            <div className={sections["data-handling-group-head"]}>
              <p className={sections["card-english"]}>
                {group.english} · {group.title}
              </p>
              <h3 id={`data-handling-${group.id}`} className={sections["data-handling-group-title"]}>
                {group.headline}
              </h3>
            </div>
            <ul className={sections["data-handling-list"]}>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
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
