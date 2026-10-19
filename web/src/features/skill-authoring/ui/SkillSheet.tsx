"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import styles from "./SkillSheet.module.css";

/**
 * 스킬 만들기·스킬 상세 시트 (Figma 1671:13573 · 1708:3848).
 * 스킬 화면 위를 어둡게 덮고 오른쪽(채팅 패널 왼쪽)에 720px 시트를 연다. 머리 줄(44) · 제목·설명 · 입력 · 아래 버튼 줄.
 * host가 있으면 그 요소(main.workspace)에 그려 사이드바까지 덮는다. 채팅 패널은 덮지 않는다.
 * testRun은 testRunTarget(채팅 패널 입력창 위 자리)이 있으면 거기에, 없으면(패널이 닫혔거나 좁은 화면) 시트 본문 끝에 둔다.
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
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  useEscapeKey(true, () => {
    if (isClosable) onClose();
  });
  // 열리면 시트로 포커스를 옮겨 키보드·화면 낭독기가 시트부터 읽게 한다.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  const inlineTestRun = testRun != null && testRunTarget == null;
  const sheet = (
    <div className={styles.layer}>
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
    </div>
  );

  return (
    <>
      {host ? createPortal(sheet, host) : sheet}
      {testRun != null && testRunTarget != null && createPortal(testRun, testRunTarget)}
    </>
  );
}
