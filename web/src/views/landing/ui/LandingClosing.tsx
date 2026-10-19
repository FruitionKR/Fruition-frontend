import Link from "next/link";
import { LANDING_FAQ, LANDING_TEAM_POINTS, LANDING_USE_CASES } from "../model/landingContent";
import { LandingTabs } from "./LandingTabs";
import { TeamPreview } from "./preview/FeatureFragments";
import styles from "./LandingPage.module.css";
import sections from "./LandingSections.module.css";

/** 어두운 띠: 팀 워크스페이스 · 권한 · 보안 */
export function LandingTeam() {
  return (
    <section id="team" className={sections["team"]} aria-labelledby="team-title">
      <div className={sections["team-inner"]}>
        <div className={sections["team-copy"]}>
          <h2 id="team-title" className={styles["h2"]}>
            혼자 쌓던 기록을
            <br />
            팀의 위키로
          </h2>
          <p className={styles["lead"]}>워크스페이스에 팀원을 초대하면 같은 문서와 위키를 함께 쓰고, 역할에 따라 할 수 있는 일을 나눕니다.</p>
          <ul className={sections["team-points"]}>
            {LANDING_TEAM_POINTS.map((point) => (
              <li key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.description}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className={sections["team-visual"]}>
          <TeamPreview />
        </div>
      </div>
    </section>
  );
}

/** 활용 사례 탭: 연구실 · 스타트업 · 학생 */
export function LandingUseCases() {
  return (
    <section id="use-cases" className={sections["section"]} aria-labelledby="use-cases-title">
      <header className={sections["section-head"]}>
        <h2 id="use-cases-title" className={styles["h2"]}>
          이런 팀에 잘 맞아요
        </h2>
      </header>
      <LandingTabs
        label="활용 사례"
        idPrefix="use-case"
        panels={LANDING_USE_CASES.map((useCase) => ({
          key: useCase.key,
          tab: useCase.tab,
          content: (
            <div className={sections["use-case"]}>
              <div className={sections["use-case-copy"]}>
                <h3 className={styles["h3"]}>{useCase.title}</h3>
                <p className={styles["lead"]}>{useCase.description}</p>
              </div>
              <ol className={sections["use-case-steps"]}>
                {useCase.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className={sections["use-case-question"]}>
                <span>이렇게 물어보세요</span>
                {useCase.question}
              </p>
            </div>
          )
        }))}
      />
    </section>
  );
}

export function LandingFaq() {
  return (
    <section id="faq" className={sections["section"]} data-width="narrow" aria-labelledby="faq-title">
      <header className={sections["section-head"]}>
        <h2 id="faq-title" className={styles["h2"]}>
          자주 묻는 질문
        </h2>
      </header>
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
        다시 찾게 될 자료, 지금 올려 두세요
      </h2>
      <p className={styles["lead"]}>문서 하나로 시작해도 충분합니다. 테스트 운영 중이라 기능과 화면은 바뀔 수 있어요.</p>
      <Link className={styles["button-primary"]} href="/login">
        Fruition 시작하기
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
