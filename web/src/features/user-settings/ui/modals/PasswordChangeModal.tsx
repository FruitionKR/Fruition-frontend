"use client";

import { useDevelopmentVerificationCode } from "@/shared/hooks/useDevelopmentVerificationCode";
import { verificationCodeLabel } from "@/shared/lib/developmentVerificationCode";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import passwordHiddenIcon from "@/shared/assets/svg/auth/auth-password-hidden.svg";
import passwordVisibleIcon from "@/shared/assets/svg/auth/auth-password-visible.svg";
import {
  buildPasswordChangeBody,
  changePasswordWithVerification,
  confirmEmailVerification,
  passwordChangeFailure,
  requestPasswordChangeVerification
} from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useExpiryCountdown } from "@/views/auth/model/useExpiryCountdown";
import { isPasswordAllowed, PASSWORD_MAX_LENGTH } from "@/shared/lib/passwordPolicy";
import { useMfaRequirement } from "../../model/useMfaRequirement";
import styles from "./AccountFlowModal.module.css";
import { FlowBackButton, FlowError, AccountFlowModal, FlowNextButton, isEmailCodeComplete, VerificationCodeInput } from "./AccountFlowModal";

type Step = "email" | "code" | "password" | "done";

function PasswordField({
  id,
  label,
  value,
  disabled,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("settings.common");
  const [isRevealed, setIsRevealed] = useState(false);
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles["field-control"]}>
        <input
          id={id}
          type={isRevealed ? "text" : "password"}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder="password"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles["field-toggle"]}
          aria-label={isRevealed ? t("passwordHide") : t("passwordShow")}
          aria-pressed={isRevealed}
          onClick={() => setIsRevealed((revealed) => !revealed)}
        >
          <Image alt="" aria-hidden src={isRevealed ? passwordVisibleIcon : passwordHiddenIcon} />
        </button>
      </div>
    </div>
  );
}

/**
 * 비밀번호 변경 3단계 모달 (Figma 1131:6030 / 6048 / 6529).
 * 현재 이메일 인증 → 인증번호 확인 → 새 비밀번호 입력. 로그인 세션 전용 계약을 쓴다:
 * POST /api/auth/me/password/verification → email-verifications confirm → PUT /api/auth/me/password/verified.
 * 인증 메일은 서버가 로그인한 계정 이메일로만 보낸다. 이메일 칸은 그 주소를 보여 주는 읽기 전용이다.
 * MFA를 켠 계정은 새 비밀번호와 함께 인증 코드도 받는다. 코드가 틀리면 같은 토큰으로 코드만 다시 받는다.
 * 변경해도 현재 세션은 유지되고 다른 세션만 해제되므로, 완료 안내 뒤 onSaved는 창만 닫는다.
 * 비밀번호가 없는 소셜 전용 계정은 서버가 거절하며(PASSWORD_LOGIN_UNAVAILABLE) 안내만 보여 주고 진행을 막는다.
 */
export function PasswordChangeModal({
  email: accountEmail,
  onSaved,
  onClose
}: {
  email: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const { isMfaEnabled, requireMfa } = useMfaRequirement();
  const [step, setStep] = useState<Step>("email");
  const SUBTITLES: Record<Step, string> = {
    email: t("passwordChange.emailSubtitle"),
    code: t("common.codeStepSubtitle"),
    password: t("passwordChange.passwordSubtitle"),
    done: t("passwordChange.doneSubtitle")
  };
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  // 인증번호 요청 제한(VERIFICATION_RATE_LIMITED)과 인증 코드 확인 제한(MFA_RATE_LIMITED)은 막는 요청이 달라 타이머를 나눈다.
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [submitBlockedUntil, setSubmitBlockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const countdown = useExpiryCountdown(expiresAt);
  const blockedSeconds = Math.max(0, Math.ceil((blockedUntil - now) / 1000));
  const submitBlockedSeconds = Math.max(0, Math.ceil((submitBlockedUntil - now) / 1000));
  const tickUntil = Math.max(blockedUntil, submitBlockedUntil);

  useEffect(() => {
    if (!tickUntil) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= tickUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tickUntil]);

  /**
   * 실패 code에 맞춰 단계를 되돌리거나 요청을 막는다. 토큰이 무효면 인증번호를 새로 받는 단계로 돌아간다.
   * 시도 제한(wait)은 실패한 요청의 타이머(block)에만 건다.
   */
  function applyFailure(cause: unknown, fallback: string, block: (until: number) => void) {
    const failure = passwordChangeFailure(cause, fallback);
    setError(failure.message);
    if (failure.recovery === "unavailable") {
      setIsUnavailable(true);
      setStep("email");
    }
    if (failure.recovery === "resend") {
      setVerificationId(null);
      setToken(null);
      setCode("");
      setNewPassword("");
      setPasswordConfirm("");
      setMfaCode("");
      setStep("email");
    }
    if (failure.recovery === "mfa") {
      setMfaCode("");
      requireMfa();
    }
    if (failure.recovery === "wait" && failure.retryAfter) {
      setNow(Date.now());
      block(Date.now() + failure.retryAfter * 1000);
    }
  }

  async function sendCode() {
    if (Date.now() < blockedUntil) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordChangeVerification();
      setVerificationId(result.verification_id);
      setExpiresAt(Date.now() + result.expires_in * 1000);
      setCode("");
      setStep("code");
    } catch (cause: unknown) {
      applyFailure(cause, t("common.sendCodeFailed"), setBlockedUntil);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!verificationId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmEmailVerification(verificationId, code.trim());
      setToken(result.verification_token);
      setStep("password");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("common.verifyCodeFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (!token || Date.now() < submitBlockedUntil) return;
    if (!isPasswordAllowed(newPassword)) {
      setError(t("passwordChange.policyError"));
      return;
    }
    if (newPassword !== passwordConfirm) {
      setError(t("passwordChange.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePasswordWithVerification(buildPasswordChangeBody({ newPassword, verificationToken: token, mfaCode }));
      setStep("done");
    } catch (cause: unknown) {
      applyFailure(cause, t("passwordChange.failed"), setSubmitBlockedUntil);
    } finally {
      setBusy(false);
    }
  }

  // 개발 환경의 고정 인증번호(9700)는 가입·비밀번호 찾기처럼 입력하면 바로 확인한다.
  useDevelopmentVerificationCode(step === "code" ? code : "", () => verifyCode());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step === "done") onSaved();
    else if (step === "email") void sendCode();
    else if (step === "code") void verifyCode();
    else void savePassword();
  }

  function handleBack() {
    if (busy) return;
    setError(null);
    if (step === "code") {
      setVerificationId(null);
      setCode("");
      setStep("email");
      return;
    }
    setToken(null);
    setNewPassword("");
    setPasswordConfirm("");
    setMfaCode("");
    setStep("code");
  }

  const canSubmit = !busy && (
    step === "done" ? true
    : step === "email"
      ? accountEmail.length > 0 && !isUnavailable && blockedSeconds === 0
      : step === "code"
        ? isEmailCodeComplete(code) && !countdown.isExpired
        : submitBlockedSeconds === 0 && newPassword.length > 0 && passwordConfirm.length > 0 && (!isMfaEnabled || mfaCode.trim().length > 0)
  );
  const submitLabel = busy ? t("common.processing")
    : step === "email" ? (blockedSeconds > 0 ? t("common.secondsLeft", { seconds: blockedSeconds }) : t("common.next")) : step === "code" ? t("common.verify") : step === "password" ? (submitBlockedSeconds > 0 ? t("common.secondsLeft", { seconds: submitBlockedSeconds }) : t("passwordChange.submit")) : t("common.confirm");

  return (
    <AccountFlowModal
      title={t("passwordChange.title")}
      subtitle={step === "done" ? <span role="status">{SUBTITLES.done}</span> : SUBTITLES[step]}
      subtitleStyle={{ whiteSpace: "pre-line" }}
      ariaLabel={t("passwordChange.title")}
      canClose={!busy}
      onClose={step === "done" ? onSaved : onClose}
      onSubmit={handleSubmit}
    >
      {step === "email" && (
        <div className={styles.field}>
          <label htmlFor="password-change-email">{t("passwordChange.emailLabel")}</label>
          <input
            id="password-change-email"
            type="email"
            autoComplete="email"
            readOnly
            value={accountEmail}
            disabled={busy}
          />
          <FlowError error={error} />
        </div>
      )}
      {step === "code" && (
        <div className={styles.field}>
          <label htmlFor="password-change-code">{verificationCodeLabel()}</label>
          <div className={styles["field-control"]}>
            <VerificationCodeInput id="password-change-code" value={code} disabled={busy} onChange={setCode} />
            <span className={styles["field-timer"]} aria-live="polite">{countdown.label}</span>
          </div>
          {countdown.isExpired ? (
            <button type="button" className={styles.resend} disabled={busy || blockedSeconds > 0} onClick={() => void sendCode()}>
              {t("passwordChange.codeExpired")}
            </button>
          ) : (
            <p className={styles.hint}>{t("common.codeSentTo", { email: accountEmail })}</p>
          )}
          <FlowError error={error} />
        </div>
      )}
      {step === "password" && (
        <div className={styles.fields}>
          <PasswordField id="password-change-new" label={t("passwordChange.newPassword")} value={newPassword} disabled={busy} onChange={setNewPassword} />
          <PasswordField id="password-change-confirm" label={t("passwordChange.newPasswordConfirm")} value={passwordConfirm} disabled={busy} onChange={setPasswordConfirm} />
          {isMfaEnabled && (
            <div className={styles.field}>
              <label htmlFor="password-change-mfa">{t("common.mfaCodeLabel")}</label>
              <input
                id="password-change-mfa"
                autoComplete="one-time-code"
                maxLength={64}
                placeholder="XXXXXX"
                value={mfaCode}
                disabled={busy}
                onChange={(event) => setMfaCode(event.target.value)}
              />
            </div>
          )}
          <p className={styles.hint}>{t("passwordChange.sessionsHint")}</p>
          <FlowError error={error} />
        </div>
      )}

      <div className={cx(styles.footer, (step === "email" || step === "done") && styles["is-end"])}>
        {(step === "code" || step === "password") && <FlowBackButton disabled={busy} onClick={handleBack} />}
        {/* autoFocus는 마운트 때만 동작한다. 완료 단계에서 버튼을 새로 마운트해 포커스를 옮겨야 Enter로 확인할 수 있다.
            이메일 단계는 입력할 칸이 없으므로 처음부터 다음 버튼에 포커스를 둔다. */}
        <FlowNextButton
          key={step === "done" ? "done" : "next"}
          disabled={!canSubmit}
          showChevron={!busy && step !== "done"}
          autoFocus={step === "email" || step === "done"}
        >
          {submitLabel}
        </FlowNextButton>
      </div>
    </AccountFlowModal>
  );
}
