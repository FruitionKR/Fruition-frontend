"use client";

import { useId } from "react";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import lightningMutedIcon from "@/shared/assets/svg/common/lightning-small-muted.svg";
import styles from "./SkillTargetCard.module.css";

/**
 * 스킬 실행 "선택 필요" 카드 (Figma 1571:27625의 1610:9246, 드롭다운은 1610:9350).
 * 채팅 패널 대화 끝에 붙어 실행할 문서를 고르게 한다. 문서를 고르거나 새 문서를 만들면 실행 준비로 넘어간다.
 */
export function SkillTargetCard({
  kindLabel,
  slug,
  description,
  options,
  isCreating,
  errorMessage,
  onPick,
  onCreateDocument,
  onCancel
}: {
  /** 스킬 종류 라벨(문서·폴더 정리·템플릿) */
  kindLabel: string;
  slug: string;
  description: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  isCreating: boolean;
  errorMessage: string | null;
  onPick: (documentId: string) => void;
  onCreateDocument: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  return (
    <section className={styles.container} aria-labelledby={titleId}>
      <p className={styles.caption}>선택 필요</p>
      <div className={styles.card}>
        <div className={styles.heading}>
          <div className={styles.meta}>
            <span className={styles.skill}>
              <SvgIcon src={lightningMutedIcon} className={styles["skill-icon"]} />
              {kindLabel} : /{slug}
            </span>
            <span className={styles["meta-side"]}>
              방금 전
              <button type="button" className={styles.cancel} disabled={isCreating} onClick={onCancel}>
                취소
              </button>
            </span>
          </div>
          <div className={styles.text}>
            <p id={titleId} className={styles.title}>
              어느 문서에 실행할까요?
            </p>
            {description && <p className={styles.sub}>{description}</p>}
          </div>
        </div>
        <OptionSelect
          value={null}
          placeholder={isCreating ? "새 문서를 만드는 중…" : options.length > 0 ? "문서 선택" : "실행할 수 있는 Markdown 문서가 없어요"}
          options={options}
          disabled={isCreating}
          action={{ label: "새 문서로 만들기", disabled: isCreating, onSelect: onCreateDocument }}
          onChange={onPick}
        />
        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </section>
  );
}
