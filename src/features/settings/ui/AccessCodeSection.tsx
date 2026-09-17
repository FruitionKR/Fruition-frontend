"use client";

import { useState } from "react";
import { cx } from "@/shared/lib/classNames";
import { useAccessGate } from "../model/useAccessGate";
import styles from "./SettingsPanel.module.css";

export function AccessCodeSection() {
  const { isEnabled, isLocked, unlock } = useAccessGate();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isEnabled) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || !code.trim()) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const ok = await unlock(code.trim());
      setMessage(ok ? "접근 코드가 확인되었습니다." : "코드가 올바르지 않습니다.");
      if (ok) setCode("");
    } catch {
      setMessage("확인 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={cx(styles["settings-section"], isLocked && styles["is-locked"])} aria-label="접근 코드">
      <h3>접근 코드</h3>
      <p className={styles["settings-section-description"]}>
        {isLocked
          ? "서비스를 사용하려면 접근 코드를 입력하세요. 입력 전에는 다른 기능이 잠깁니다."
          : "이 브라우저는 접근 코드가 확인된 상태입니다."}
      </p>
      <form className={styles["settings-inline-form"]} onSubmit={handleSubmit}>
        <input
          aria-label="접근 코드"
          autoComplete="off"
          name="access-code"
          placeholder="접근 코드"
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" className={styles["settings-reset"]} disabled={isSubmitting || !code.trim()}>
          확인
        </button>
      </form>
      {message && <p className={styles["settings-message"]} role="status">{message}</p>}
    </section>
  );
}
