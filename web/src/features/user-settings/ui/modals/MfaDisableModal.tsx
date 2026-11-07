"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { disableMfa } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import styles from "./AccountFlowModal.module.css";
import { FlowError, AccountFlowModal, FlowNextButton } from "./AccountFlowModal";

/** 다단계 인증 해제 모달 (Figma 1127:5158). */
export function MfaDisableModal({ onDisabled, onClose }: { onDisabled: () => void; onClose: () => void }) {
  const t = useTranslations("settings");
  const tShared = useTranslations("shared");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await disableMfa(code.trim());
      onDisabled();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("mfa.disable.failed"), tShared));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFlowModal
      title={t("mfa.disable.title")}
      subtitle={t("mfa.disable.subtitle")}
      ariaLabel={t("mfa.disable.title")}
      canClose={!busy}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className={styles.field}>
        <div className={styles["field-head"]}>
          <label htmlFor="mfa-disable-code">{t("common.mfaCodeLabel")}</label>
          <p className={styles["field-desc"]}>{t("common.mfaCodeReuseHint")}</p>
        </div>
        <input
          id="mfa-disable-code"
          autoComplete="one-time-code"
          maxLength={64}
          placeholder="XXXXXX"
          autoFocus
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
        />
        <FlowError error={error} />
      </div>
      <div className={cx(styles.footer, styles["is-end"])}>
        <FlowNextButton className={styles["is-dim"]} disabled={busy || !code.trim()} showChevron={!busy}>
          {busy ? t("common.checking") : t("mfa.disable.submit")}
        </FlowNextButton>
      </div>
    </AccountFlowModal>
  );
}
