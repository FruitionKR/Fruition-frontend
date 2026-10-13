"use client";

import { useId } from "react";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { SkillCoachArrow } from "./SkillIcons";
import styles from "./SkillRunCoach.module.css";

/**
 * 스킬 실행 대상 고르기 안내 (Figma 1527:15924). 메인 영역을 어둡게 덮고 사이드바 쪽을 가리키는 말풍선을 띄운다.
 * 사이드바는 덮지 않아 그대로 문서를 고를 수 있다.
 */
export function SkillRunCoach({
  hasTarget,
  errorMessage,
  onCancel,
  onNext
}: {
  /** 사이드바에서 문서를 골랐는지. 고르기 전에는 다음 버튼을 막는다 */
  hasTarget: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onNext: () => void;
}) {
  const titleId = useId();
  useEscapeKey(true, onCancel);

  return (
    <div className={styles.coach}>
      <div className={styles.dim} onClick={onCancel} aria-hidden />
      <section className={styles.popover} role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <SkillCoachArrow className={styles.arrow} />
        <div className={styles.text}>
          <h2 id={titleId}>
            <em>실행할 문서</em>를 선택해주세요.
          </h2>
          <p>스킬은 한 번에 문서 하나에 실행합니다.</p>
          {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>취소</button>
          <button type="button" className={styles.next} disabled={!hasTarget} onClick={onNext}>다음</button>
        </div>
      </section>
    </div>
  );
}
