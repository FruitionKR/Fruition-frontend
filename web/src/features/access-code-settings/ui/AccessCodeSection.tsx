"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AccessCodeSubmitResult } from "@/shared/api/accessGate";
import { cx } from "@/shared/lib/classNames";
import { useAccessGate } from "../model/useAccessGate";
import styles from "./AccessCodeSettingsPanel.module.css";

/** 확인 결과별 안내. error는 요청 자체가 실패한 경우다. 문구는 workspace.accessCode.result에 있다. */
type UnlockMessage = AccessCodeSubmitResult | "error";

export function AccessCodeSection() {
  const t = useTranslations("workspace.accessCode");
  const { isEnabled, isLocked, unlock } = useAccessGate();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<UnlockMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isEnabled) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || !code.trim()) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await unlock(code.trim());
      setMessage(result);
      if (result === "ok") setCode("");
    } catch {
      setMessage("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={cx(styles["settings-section"], isLocked && styles["is-locked"])} aria-label={t("title")}>
      <h3>{t("title")}</h3>
      <p className={styles["settings-section-description"]}>
        {isLocked
          ? t("lockedDescription")
          : t("unlockedDescription")}
      </p>
      <form className={styles["settings-inline-form"]} onSubmit={handleSubmit}>
        <input
          aria-label={t("title")}
          autoComplete="off"
          name="access-code"
          placeholder={t("title")}
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" className={styles["settings-reset"]} disabled={isSubmitting || !code.trim()}>
          {t("submit")}
        </button>
      </form>
      {message && <p className={styles["settings-message"]} role="status">{t(`result.${message === "rate-limited" ? "rateLimited" : message}`)}</p>}
    </section>
  );
}
