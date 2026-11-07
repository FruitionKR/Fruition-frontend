"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { activateMfa, type MfaRegistration } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { copyIcon, downloadIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./AccountFlowModal.module.css";
import { CODE_LENGTH, FlowBackButton, FlowError, AccountFlowModal, FlowNextButton, VerificationCodeInput } from "./AccountFlowModal";

type SetupStep = "connect" | "verify" | "recovery";

/** 다단계 인증 등록 3단계 모달 (Figma 1126:5042 / 1126:5096 / 1126:5056). */
export function MfaSetupModal({
  registration,
  onActivated,
  onClose
}: {
  registration: MfaRegistration;
  /** 활성화 API 성공 직후(복구 코드 보관 전) 호출해 상태를 다시 읽는다. */
  onActivated: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const tShared = useTranslations("shared");
  const [step, setStep] = useState<SetupStep>("connect");
  const [code, setCode] = useState("");
  const [codesSaved, setCodesSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await activateMfa(code.trim());
      onActivated();
      setStep("recovery");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("mfa.setup.verifyFailed"), tShared));
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(registration.recovery_codes.join("\n"));
      setMessage(t("mfa.setup.copied"));
      setError(null);
    } catch {
      setError(t("mfa.setup.copyFailed"));
    }
  }

  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob([`${t("mfa.setup.fileHeading")}\n\n`, registration.recovery_codes.join("\n")], { type: "text/plain;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "fruition-recovery-codes.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(t("mfa.setup.downloadStarted"));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step === "connect") setStep("verify");
    else if (step === "verify") void verify();
    else if (codesSaved) onClose();
  }

  const meta = {
    connect: { label: t("mfa.setup.connect.label"), title: t("mfa.setup.connect.title"), subtitle: t("mfa.setup.connect.subtitle") },
    verify: { label: t("mfa.setup.verify.label"), title: t("mfa.setup.verify.title"), subtitle: t("mfa.setup.verify.subtitle") },
    recovery: {
      label: t("mfa.setup.recovery.label"),
      title: t("mfa.setup.recovery.title"),
      subtitle: <>{t("mfa.setup.recovery.subtitleKeep")}<br />{t("mfa.setup.recovery.subtitleOnce")}</>
    }
  }[step];
  // 복구 코드 단계는 보관 확인 전에 닫을 수 없다.
  const canClose = !busy && step !== "recovery";

  return (
    <AccountFlowModal
      title={meta.title}
      stepLabel={meta.label}
      subtitle={meta.subtitle}
      ariaLabel={t("mfa.setup.ariaLabel")}
      canClose={canClose}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {step === "connect" && (
        <div className={styles["qr-block"]}>
          <div className={styles.qr}>
            <QRCodeSVG value={registration.otpauth_uri} size={184} marginSize={0} level="M" role="img" aria-label={t("mfa.setup.qrLabel")} />
          </div>
          <div className={styles.field}>
            <div className={styles["field-head"]}>
              <label htmlFor="mfa-secret">{t("mfa.setup.secretLabel")}</label>
              <p className={styles["field-desc"]}>{t("mfa.setup.secretHint")}</p>
            </div>
            <input id="mfa-secret" readOnly value={registration.secret} onFocus={(event) => event.target.select()} />
          </div>
        </div>
      )}
      {step === "verify" && (
        <div className={styles.field}>
          <div className={styles["field-head"]}>
            <label htmlFor="mfa-code">{t("mfa.setup.codeLabel")}</label>
            <p className={styles["field-desc"]}>{t("common.mfaCodeReuseHint")}</p>
          </div>
          <VerificationCodeInput id="mfa-code" value={code} disabled={busy} onChange={setCode} />
          <FlowError error={error} />
        </div>
      )}
      {step === "recovery" && (
        <div className={styles.field}>
          <div className={styles["field-title-row"]}>
            <label>{t("mfa.setup.recoveryCodes")}</label>
            <div className={styles["icon-actions"]}>
              <button type="button" className={styles["icon-button"]} aria-label={t("mfa.setup.copy")} onClick={() => void copyCodes()}>
                <SvgIcon src={copyIcon} />
              </button>
              <button type="button" className={styles["icon-button"]} aria-label={t("mfa.setup.download")} onClick={downloadCodes}>
                <SvgIcon src={downloadIcon} />
              </button>
            </div>
          </div>
          <div className={styles["recovery-box"]}>
            <ul className={styles["recovery-grid"]}>
              {registration.recovery_codes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <label className={styles["check-row"]}>
            <input type="checkbox" checked={codesSaved} onChange={(event) => setCodesSaved(event.target.checked)} />
            {t("mfa.setup.savedCheck")}
          </label>
          {message && <p className={styles.status} role="status">{message}</p>}
          <FlowError error={error} />
        </div>
      )}

      <div className={cx(styles.footer, step !== "verify" && styles["is-end"])}>
        {step === "verify" && <FlowBackButton disabled={busy} onClick={() => { setError(null); setStep("connect"); }} />}
        <FlowNextButton
          disabled={busy || (step === "verify" && code.trim().length !== CODE_LENGTH) || (step === "recovery" && !codesSaved)}
          showChevron={!busy && step !== "recovery"}
        >
          {busy ? t("common.checking") : step === "connect" ? t("common.next") : step === "verify" ? t("common.verify") : t("mfa.setup.finish")}
        </FlowNextButton>
      </div>
    </AccountFlowModal>
  );
}
