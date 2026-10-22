"use client";

import { useId } from "react";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { SkillCoachArrow } from "./SkillIcons";
import styles from "./SkillRunCoach.module.css";

/**
 * 스킬 실행 대상 고르기 안내 (Figma 1567:25081 tutorial_1). 메인 영역을 어둡게 덮고 사이드바 쪽을 가리키는 말풍선을 띄운다.
 * 사이드바는 덮지 않아 그대로 문서·폴더를 고를 수 있다. 고르기 전에는 '다음'을 막는다.
 */
export function SkillRunCoach({
  hasTarget,
  preview,
  errorMessage,
  onCancel,
  onNext
}: {
  /** 사이드바에서 쓸 수 있는 대상을 골랐는지 */
  hasTarget: boolean;
  /** 고른 대상으로 무엇을 할지 미리 알리는 문구(원문 문서를 읽는지 등). 없으면 감춘다. */
  preview?: string | null;
  /** 고른 항목을 대상으로 쓸 수 없을 때 안내(폴더 정리 스킬에 문서를 고른 경우, 선택한 부분에만 쓰는 스킬 등) */
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
          <p>
            문서 스킬은 고칠 문서(또는 요약·변환할 문서나
            <br />
            새 문서를 둘 폴더)를,
            <br />
            폴더 정리 스킬은 정리할 폴더를 고릅니다.
          </p>
          {preview && !errorMessage && <p className={styles.preview} role="status">{preview}</p>}
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
