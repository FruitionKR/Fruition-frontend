"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useUserPreferences } from "@/entities/user";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { cx } from "@/shared/lib/classNames";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import styles from "./SkillSheet.module.css";

/** 시트가 오른쪽으로 빠져나가는 시간. SkillSheet.module.css의 skill-sheet-out과 맞춘다. */
const SKILL_SHEET_EXIT_MS = 200;

/**
 * 시트 닫기 (디자이너 코멘트: "기존 채팅창 유지하면서 move in으로 들어오는 스킬 상세, 내부에서 수정 → 저장 시 반영").
 * - requestClose: 취소·Escape·바깥 누르기. 저장하지 않은 수정이 있으면 버릴지 먼저 묻는다.
 * - close: 저장·삭제가 끝났거나 버리기를 골랐다. 오른쪽으로 빠져나간 뒤(동작 줄이기면 바로) onClose를 부른다.
 */
export function useSkillSheetClose(onClose: () => void, isDirty: boolean) {
  const { reduceMotion } = useUserPreferences();
  const [isLeaving, setIsLeaving] = useState(false);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  const close = useCallback(() => {
    setIsDiscardConfirmOpen(false);
    if (reduceMotion) {
      onClose();
      return;
    }
    setIsLeaving(true);
    if (timerRef.current == null) timerRef.current = window.setTimeout(onClose, SKILL_SHEET_EXIT_MS);
  }, [onClose, reduceMotion]);

  const requestClose = useCallback(() => {
    if (isLeaving) return;
    if (isDirty) setIsDiscardConfirmOpen(true);
    else close();
  }, [close, isDirty, isLeaving]);

  return {
    isLeaving,
    close,
    requestClose,
    discardConfirm: { isOpen: isDiscardConfirmOpen, onDiscard: close, onKeep: () => setIsDiscardConfirmOpen(false) }
  };
}

/**
 * 스킬 만들기·스킬 상세 시트 (Figma 1671:13573 · 1708:3848).
 * 스킬 화면 위를 어둡게 덮고 오른쪽(채팅 패널 왼쪽)에 720px 시트를 연다. 머리 줄(44) · 제목·설명 · 입력 · 아래 버튼 줄.
 * host가 있으면 그 요소(main.workspace)에 그려 사이드바까지 덮는다. 채팅 패널은 덮지 않는다.
 * testRun은 testRunTarget(채팅 패널 작업 탭의 입력창 위 자리)이 있으면 거기에, 없으면(패널이 닫혔거나 좁은 화면) 시트 본문 끝에 둔다.
 * 열 때 오른쪽에서 밀려 들어오고, isLeaving이면 오른쪽으로 빠져나간다. onClose는 닫기 요청(useSkillSheetClose.requestClose)이다.
 */
export function SkillSheet({
  host,
  titleId,
  headerLabel,
  title,
  subtitle,
  footerStart,
  actions,
  testRun,
  testRunTarget,
  isClosable = true,
  isLeaving = false,
  discardConfirm,
  onClose,
  children
}: {
  host: HTMLElement | null;
  titleId: string;
  headerLabel: string;
  title: string;
  subtitle: string;
  footerStart?: ReactNode;
  actions: ReactNode;
  testRun?: ReactNode;
  testRunTarget?: HTMLElement | null;
  /** 저장·삭제 중에는 Escape·바깥 누르기로 닫지 않는다. */
  isClosable?: boolean;
  /** 닫히는 중(빠져나가는 동작). */
  isLeaving?: boolean;
  /** 저장하지 않은 수정을 버릴지 묻는 확인. */
  discardConfirm?: { isOpen: boolean; onDiscard: () => void; onKeep: () => void };
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const discardTitleId = useId();
  useEscapeKey(true, () => {
    if (isClosable) onClose();
  });
  // 열리면 시트로 포커스를 옮겨 키보드·화면 낭독기가 시트부터 읽게 한다.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  const inlineTestRun = testRun != null && testRunTarget == null;
  const sheet = (
    <div className={cx(styles.layer, isLeaving && styles["is-leaving"])}>
      <div
        className={styles.dimmed}
        aria-hidden
        onClick={() => {
          if (isClosable) onClose();
        }}
      />
      <section ref={sheetRef} className={styles.sheet} role="dialog" aria-labelledby={titleId} tabIndex={-1}>
        <header className={styles.bar}>
          <p className={styles["bar-title"]}>{headerLabel}</p>
        </header>
        <div className={styles.body}>
          <div className={styles.hero}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          {children}
          {inlineTestRun && <div className={styles["inline-test-run"]}>{testRun}</div>}
        </div>
        <footer className={styles.footer}>
          <div className={styles["footer-start"]}>{footerStart}</div>
          <div className={styles["footer-end"]}>{actions}</div>
        </footer>
      </section>
      {discardConfirm?.isOpen && (
        <AlertModal
          titleId={discardTitleId}
          title="수정한 내용을 버리시겠습니까?"
          description="저장하지 않은 내용은 반영되지 않습니다."
          onClose={discardConfirm.onKeep}
        >
          <div className="modal-actions">
            <button type="button" className="modal-cancel-button" autoFocus onClick={discardConfirm.onKeep}>
              계속 수정
            </button>
            <button type="button" className="modal-delete-button" onClick={discardConfirm.onDiscard}>
              버리기
            </button>
          </div>
        </AlertModal>
      )}
    </div>
  );

  return (
    <>
      {host ? createPortal(sheet, host) : sheet}
      {testRun != null && testRunTarget != null && createPortal(testRun, testRunTarget)}
    </>
  );
}
