import Link from "next/link";
import { LANDING_FAQ, LANDING_FLOW } from "../model/landingContent";
import styles from "./LandingPage.module.css";
import closingStyles from "./LandingClosing.module.css";

export function LandingFlow() {
  return (
    <section id="flow" className={closingStyles["flow"]} aria-labelledby="flow-title">
      <div className={closingStyles["flow-inner"]}>
        <p className={styles["kicker"]}>ONE CONTINUOUS FLOW</p>
        <h2 id="flow-title" className={styles["section-title"]}>
          기록의 끝이,
          <br />
          지식의 시작이 되도록.
        </h2>
        <p className={styles["section-lead"]}>Fruition은 문서의 생애주기를 하나의 흐름으로 연결합니다.</p>
        <ol className={closingStyles["flow-steps"]}>
          {LANDING_FLOW.map((step) => (
            <li key={step.index}>
              <span className={closingStyles["flow-index"]}>{step.index}</span>
              <strong>{step.title}</strong>
              <span className={closingStyles["flow-detail"]}>{step.detail}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function LandingFaqSection() {
  return (
    <section id="faq" className={closingStyles["faq"]} aria-labelledby="faq-title">
      <header className={styles["centered-header"]}>
        <p className={styles["kicker"]}>A FEW MORE THINGS</p>
        <h2 id="faq-title" className={styles["section-title"]}>
          궁금한 점을 모았어요.
        </h2>
        <p className={styles["section-lead"]}>Fruition을 시작하기 전에 알아두면 좋은 이야기.</p>
      </header>
      <div className={closingStyles["faq-list"]}>
        {LANDING_FAQ.map((item) => (
          <details key={item.question} className={closingStyles["faq-item"]}>
            <summary>
              <span>{item.question}</span>
              <span className={closingStyles["faq-icon"]} aria-hidden="true" />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function LandingStart() {
  return (
    <section id="start" className={closingStyles["start"]} aria-labelledby="start-title">
      <p className={styles["kicker"]}>YOUR NEXT USEFUL RECORD</p>
      <h2 id="start-title" className={styles["section-title"]}>
        다시 쓰고 싶은 기록,
        <br />
        하나부터 시작해 보세요.
      </h2>
      <p className={styles["section-lead"]}>
        자료 하나를 모으고, 연결된 지식을 살펴보고, 질문해 보세요.{" "}
        <br />
        기록이 다음 작업에 쓰이는 순간을 Fruition에서 만나보세요.
      </p>
      <Link className={styles["button-primary"]} href="/login">
        Fruition 시작하기
        <span aria-hidden="true">→</span>
      </Link>
      <p className={closingStyles["start-note"]}>테스트 운영 중인 서비스예요 · 기능과 화면은 바뀔 수 있어요</p>
    </section>
  );
}

export function LandingClosing() {
  return (
    <>
      <LandingFaqSection />
      <LandingStart />
    </>
  );
}
