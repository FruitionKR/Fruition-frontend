"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { cx } from "@/shared/lib/classNames";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import modalStyles from "@/shared/ui/modal/CenteredModal.module.css";
import { plusIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { TUTORIAL_SECTIONS } from "../model/tutorialContent";
import { useTutorialProgress } from "../model/useTutorial";
import { TutorialIconGlyph } from "./TutorialIcons";
import styles from "./TutorialDialog.module.css";

/** 01, 02 … 단계·섹션 번호 */
const pad = (value: number) => String(value).padStart(2, "0");

/** ←/→로 단계를 옮기되, 글을 고르거나 입력하는 요소에서는 브라우저 기본 동작에 맡긴다. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * 서비스 사용 방법 모달. 레일 `?` 버튼(SidebarProfile)이 연다.
 * 왼쪽 섹션 목록(휴대폰은 위쪽 가로 칩) · 오른쪽 섹션 머리와 지금 단계 · 아래 이전/다음과 진행 표시.
 * 마지막으로 본 단계는 localStorage에 남아 다시 열면 그 자리에서 이어진다(useTutorialProgress).
 */
export function TutorialDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("tutorial.ui");
  const tc = useTranslations("tutorialContent");
  // 섹션·단계 id는 내용 파일(tutorialContent.ts)이 정하는 string이라 키 타입을 넓혀 쓴다.
  const text = (key: string) => tc(key as Parameters<typeof tc>[0]);
  const titleId = useId();
  const sectionsLabelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const tutorial = useTutorialProgress(TUTORIAL_SECTIONS);
  const { section, step, position, progress } = tutorial;

  // 열리면 모달 안으로 포커스를 옮겨 바로 ←/→·Tab이 모달 안에서 동작하게 한다. 닫힐 때 복귀는 CenteredModal이 맡는다.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // 휴대폰 가로 칩에서 지금 섹션이 화면 밖이면 보이는 곳까지 옮긴다. 넓은 화면 세로 목록에서도 같은 규칙이다.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>(`[data-section-index="${position.sectionIndex}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [position.sectionIndex]);

  if (!section || !step) return null;

  function finish() {
    tutorial.finish();
    onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
    if (event.key === "ArrowRight" && !tutorial.isLast) {
      event.preventDefault();
      tutorial.goNext();
    } else if (event.key === "ArrowLeft" && !tutorial.isFirst) {
      event.preventDefault();
      tutorial.goPrev();
    }
  }

  return (
    <CenteredModal ariaLabel={t("title")} labelledBy={titleId} className={styles.box} onClose={onClose}>
      <div ref={rootRef} className={styles.root} tabIndex={-1} onKeyDown={handleKeyDown}>
        <aside className={styles.nav}>
          <h2 id={titleId} className={styles.title}>{t("title")}</h2>
          <p id={sectionsLabelId} className={styles["nav-label"]}>{t("sections")}</p>
          <ol className={styles.sections} aria-labelledby={sectionsLabelId}>
            {TUTORIAL_SECTIONS.map((item, index) => {
              const isActive = index === position.sectionIndex;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cx(styles.section, isActive && styles["is-active"], index < position.sectionIndex && styles["is-done"])}
                    aria-current={isActive ? "step" : undefined}
                    data-section-index={index}
                    onClick={() => tutorial.goToSection(index)}
                  >
                    <span className={styles["section-icon"]}>
                      <TutorialIconGlyph name={item.icon} />
                    </span>
                    <span className={styles["section-title"]}>{text(`sections.${item.id}.title`)}</span>
                    <span className={styles["section-count"]} aria-hidden>{item.steps.length}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className={styles.main} aria-labelledby={`${titleId}-section`}>
          <header className={styles.head}>
            <p className={styles.eyebrow} aria-hidden>{pad(position.sectionIndex + 1)}</p>
            <h3 id={`${titleId}-section`} className={styles["section-heading"]}>{text(`sections.${section.id}.title`)}</h3>
            <p className={styles.summary}>{text(`sections.${section.id}.summary`)}</p>
          </header>

          {section.steps.length > 1 && (
            <ol className={styles.steps}>
              {section.steps.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cx(styles["step-dot"], index === position.stepIndex && styles["is-active"], index < position.stepIndex && styles["is-done"])}
                    aria-current={index === position.stepIndex ? "step" : undefined}
                    aria-label={text(`steps.${item.id}.title`)}
                    onClick={() => tutorial.goToStep(index)}
                  >
                    {index + 1}
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* key로 단계마다 새로 그려 들어오는 움직임(transform·opacity)을 다시 재생한다. */}
          <article key={step.id} className={styles.step} aria-live="polite">
            <div className={styles["step-mark"]}>
              <span className={styles["step-number"]}>
                {pad(position.stepIndex + 1)}
                <span className={styles["step-of"]}>/{pad(section.steps.length)}</span>
              </span>
              {/* 단계 아이콘은 선택이라, 없으면 섹션 아이콘으로 카드 모양을 맞춘다. */}
              <span className={styles["step-icon"]}>
                <TutorialIconGlyph name={step.icon ?? section.icon} />
              </span>
            </div>
            <h4 className={styles["step-title"]}>{text(`steps.${step.id}.title`)}</h4>
            <p className={styles["step-body"]}>{text(`steps.${step.id}.body`)}</p>
          </article>

          <footer className={styles.footer}>
            <div className={styles.progress}>
              <span className={styles["progress-text"]}>{t("progress", progress)}</span>
              <span className={styles["progress-track"]} aria-hidden>
                <span
                  className={styles["progress-fill"]}
                  style={{ transform: `scaleX(${progress.total ? progress.current / progress.total : 0})` }}
                />
              </span>
            </div>
            <div className={styles.actions}>
              {/* disabled면 첫 단계로 돌아온 순간 포커스가 body로 빠져 ←/→와 포커스 가두기가 끊긴다. */}
              <button type="button" className={styles.prev} aria-disabled={tutorial.isFirst} onClick={tutorial.isFirst ? undefined : tutorial.goPrev}>
                {t("prev")}
              </button>
              <button type="button" className={styles.next} onClick={tutorial.isLast ? finish : tutorial.goNext}>
                {tutorial.isLast ? t("done") : t("next")}
              </button>
            </div>
          </footer>
        </section>

        <button type="button" className={cx(modalStyles["modal-close"], styles.close)} aria-label={t("close")} onClick={onClose}>
          <SvgIcon src={plusIcon} className={modalStyles["modal-close-icon"]} />
        </button>
      </div>
    </CenteredModal>
  );
}
