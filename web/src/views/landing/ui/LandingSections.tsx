import Link from "next/link";
import { cx } from "@/shared/lib/classNames";
import { LANDING_BENTO, LANDING_FEATURES, type LandingFeature } from "../model/landingContent";
import { BentoPreview } from "./preview/BentoFragments";
import { AnswerPreview, GraphPreview, UploadPreview } from "./preview/FeatureFragments";
import styles from "./LandingPage.module.css";
import sections from "./LandingSections.module.css";

const FLOW_INPUTS = ["PDF 문서", "회의 녹음", "메모 · Markdown", "채팅 기록"] as const;
const FLOW_OUTPUTS = [
  { label: "개념 페이지", kind: "concept" },
  { label: "출처 페이지", kind: "source" },
  { label: "지식 그래프", kind: "graph" },
  { label: "근거 있는 답변", kind: "answer" }
] as const;

/** 흐름도: 여러 형태의 자료 → 위키 편입 → 위키·그래프·답변 */
export function LandingFlow() {
  return (
    <section id="flow" className={sections["section"]} aria-labelledby="flow-title">
      <header className={sections["section-head"]} data-align="center">
        <h2 id="flow-title" className={styles["h2"]}>
          자료가 들어오면, 위키가 알아서 자랍니다
        </h2>
        <p className={styles["lead"]}>형식이 달라도 괜찮아요. 위키에 편입되면 같은 언어로 정리되고 서로 이어집니다.</p>
      </header>
      <div className={sections["flow"]}>
        <ul className={sections["flow-column"]} aria-label="올리는 자료">
          {FLOW_INPUTS.map((input) => (
            <li key={input} className={sections["flow-chip"]} data-kind="raw">
              {input}
            </li>
          ))}
        </ul>
        <span className={sections["flow-arrow"]} aria-hidden="true" />
        <div className={sections["flow-core"]}>
          <p className={sections["flow-core-title"]}>위키 편입</p>
          <p className={sections["flow-core-text"]}>핵심 개념을 뽑고 출처를 연결해 페이지로 정리합니다</p>
        </div>
        <span className={sections["flow-arrow"]} aria-hidden="true" />
        <ul className={sections["flow-column"]} aria-label="만들어지는 지식">
          {FLOW_OUTPUTS.map((output) => (
            <li key={output.label} className={sections["flow-chip"]} data-kind={output.kind}>
              {output.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FeaturePreview({ id }: { id: LandingFeature["id"] }) {
  if (id === "capture") return <UploadPreview />;
  if (id === "connect") return <GraphPreview />;
  return <AnswerPreview />;
}

/** 핵심 기능 3개를 좌우 교차 배치로 */
export function LandingFeatures() {
  return (
    <div className={sections["features"]}>
      {LANDING_FEATURES.map((feature, index) => (
        <section
          key={feature.id}
          id={feature.id}
          className={cx(sections["feature"], index % 2 === 1 && sections["is-reversed"])}
          aria-labelledby={`${feature.id}-title`}
        >
          <div className={sections["feature-copy"]}>
            <p className={styles["label"]}>{feature.label}</p>
            <h2 id={`${feature.id}-title`} className={styles["h2"]}>
              {feature.title[0]}
              <br />
              {feature.title[1]}
            </h2>
            <p className={styles["lead"]}>{feature.description}</p>
            <ul className={sections["checklist"]}>
              {feature.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <div className={sections["feature-visual"]}>
            <FeaturePreview id={feature.id} />
          </div>
        </section>
      ))}
    </div>
  );
}

/** 그 밖의 기능 묶음(벤토)과 중간 안내 */
export function LandingBento() {
  return (
    <section id="more" className={sections["section"]} aria-labelledby="more-title">
      <header className={sections["section-head"]}>
        <h2 id="more-title" className={styles["h2"]}>
          매일 쓰는 일도 함께 정리됩니다
        </h2>
        <p className={styles["lead"]}>문서를 고치고, 회의를 남기고, 위키를 다듬는 일까지 한 화면에서 이어집니다.</p>
      </header>
      <ul className={sections["bento"]}>
        {LANDING_BENTO.map((item) => (
          <li key={item.id} className={sections["bento-card"]} data-id={item.id}>
            <div className={sections["bento-copy"]}>
              <h3 className={styles["h3"]}>{item.title}</h3>
              <p>{item.description}</p>
            </div>
            <div className={sections["bento-visual"]}>
              <BentoPreview id={item.id} />
            </div>
          </li>
        ))}
      </ul>
      <div className={sections["inline-cta"]}>
        <p>내 자료 하나로 바로 확인해 보세요.</p>
        <Link className={styles["button-primary"]} href="/login">
          시작하기
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
