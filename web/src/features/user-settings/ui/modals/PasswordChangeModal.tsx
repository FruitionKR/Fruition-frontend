"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import passwordHiddenIcon from "@/shared/assets/svg/auth/auth-password-hidden.svg";
import passwordVisibleIcon from "@/shared/assets/svg/auth/auth-password-visible.svg";
import {
  changePasswordWithVerification,
  confirmEmailVerification,
  passwordChangeFailure,
  requestPasswordChangeVerification
} from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useExpiryCountdown } from "@/views/auth/model/useExpiryCountdown";
import { isPasswordAllowed, PASSWORD_MAX_LENGTH } from "@/shared/lib/passwordPolicy";
import styles from "./AccountFlowModal.module.css";
import { CODE_LENGTH, FlowBackButton, FlowError, AccountFlowModal, FlowNextButton, VerificationCodeInput } from "./AccountFlowModal";

type Step = "email" | "code" | "password" | "done";

const SUBTITLES: Record<Step, string> = {
  email: "현재 이메일 계정을 인증합니다.",
  code: "인증번호 6자리를 입력하여 이메일을 인증하세요.",
  password: "최소 15자의 문자 또는\n최소 8자의 문자와 숫자 조합을 비밀번호로 사용하세요.",
  done: "비밀번호가 변경되었습니다.\n다른 기기의 로그인은 해제되었습니다."
};

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
          aria-label={isRevealed ? "비밀번호 숨기기" : "비밀번호 표시"}
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
  const [step, setStep] = useState<Step>("email");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const countdown = useExpiryCountdown(expiresAt);
  const blockedSeconds = Math.max(0, Math.ceil((blockedUntil - now) / 1000));

  useEffect(() => {
    if (!blockedUntil) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= blockedUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [blockedUntil]);

  /** 실패 code에 맞춰 단계를 되돌리거나 요청을 막는다. 토큰이 무효면 인증번호를 새로 받는 단계로 돌아간다. */
  function applyFailure(cause: unknown, fallback: string) {
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
      setStep("email");
    }
    if (failure.recovery === "wait" && failure.retryAfter) {
      setNow(Date.now());
      setBlockedUntil(Date.now() + failure.retryAfter * 1000);
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
      applyFailure(cause, "인증번호를 보내지 못했습니다.");
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
      setError(getErrorMessage(cause, "인증번호 확인에 실패했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (!token) return;
    if (!isPasswordAllowed(newPassword)) {
      setError("최소 15자의 문자 또는 최소 8자의 문자와 숫자 조합이어야 합니다.");
      return;
    }
    if (newPassword !== passwordConfirm) {
      setError("새 비밀번호와 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePasswordWithVerification(newPassword, token);
      setStep("done");
    } catch (cause: unknown) {
      applyFailure(cause, "비밀번호를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

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
    setStep("code");
  }

  const canSubmit = !busy && (
    step === "done" ? true
    : step === "email"
      ? accountEmail.length > 0 && !isUnavailable && blockedSeconds === 0
      : step === "code"
        ? code.trim().length === CODE_LENGTH && !countdown.isExpired
        : newPassword.length > 0 && passwordConfirm.length > 0
  );
  const submitLabel = busy ? "처리 중…"
    : step === "email" ? (blockedSeconds > 0 ? `${blockedSeconds}초 후 가능` : "다음으로") : step === "code" ? "인증하기" : step === "password" ? "비밀번호 변경" : "확인";

  return (
    <AccountFlowModal
      title="비밀번호 변경"
      subtitle={step === "done" ? <span role="status">{SUBTITLES.done}</span> : SUBTITLES[step]}
      subtitleStyle={{ whiteSpace: "pre-line" }}
      ariaLabel="비밀번호 변경"
      canClose={!busy}
      onClose={step === "done" ? onSaved : onClose}
      onSubmit={handleSubmit}
    >
      {step === "email" && (
        <div className={styles.field}>
          <label htmlFor="password-change-email">이메일 주소</label>
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
          <label htmlFor="password-change-code">인증번호 6자리</label>
          <div className={styles["field-control"]}>
            <VerificationCodeInput id="password-change-code" value={code} disabled={busy} onChange={setCode} />
            <span className={styles["field-timer"]} aria-live="polite">{countdown.label}</span>
          </div>
          {countdown.isExpired ? (
            <button type="button" className={styles.resend} disabled={busy || blockedSeconds > 0} onClick={() => void sendCode()}>
              인증번호가 만료되었습니다. 다시 받기
            </button>
          ) : (
            <p className={styles.hint}>{accountEmail} 주소로 인증번호를 보냈습니다.</p>
          )}
          <FlowError error={error} />
        </div>
      )}
      {step === "password" && (
        <div className={styles.fields}>
          <PasswordField id="password-change-new" label="새 비밀번호" value={newPassword} disabled={busy} onChange={setNewPassword} />
          <PasswordField id="password-change-confirm" label="새 비밀번호 확인" value={passwordConfirm} disabled={busy} onChange={setPasswordConfirm} />
          <p className={styles.hint}>변경하면 다른 기기의 로그인 갱신이 해제됩니다.</p>
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
