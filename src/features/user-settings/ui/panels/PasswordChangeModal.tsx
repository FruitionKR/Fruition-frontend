"use client";

import { ChevronRight } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import passwordHiddenIcon from "../../../../../svg/auth/auth-password-hidden.svg";
import passwordVisibleIcon from "../../../../../svg/auth/auth-password-visible.svg";
import { confirmEmailVerification, requestEmailVerification, resetPasswordWithVerification } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/errors";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";
import { plusIcon, skillBackIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { useExpiryCountdown } from "@/views/auth/lib/useExpiryCountdown";
import { isPasswordAllowed, PASSWORD_MAX_LENGTH } from "../../lib/passwordPolicy";
import styles from "./AccountFlowModal.module.css";

const CODE_LENGTH = 6;

type Step = "email" | "code" | "password";

const SUBTITLES: Record<Step, string> = {
  email: "현재 이메일 계정을 인증합니다.",
  code: "인증번호 6자리를 입력하여 이메일을 인증하세요.",
  password: "최소 15자의 문자 또는\n최소 8자의 문자와 숫자 조합을 비밀번호로 사용하세요."
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
 * 현재 이메일 인증 → 인증번호 확인 → 새 비밀번호 입력. 인증 토큰으로 password-reset 계약을 사용한다.
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
  const [email, setEmail] = useState(accountEmail);
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useExpiryCountdown(expiresAt);

  useEscapeKey(!busy, onClose);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestEmailVerification(email.trim(), "password_reset");
      setVerificationId(result.verification_id);
      setExpiresAt(Date.now() + result.expires_in * 1000);
      setCode("");
      setStep("code");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "인증번호를 보내지 못했습니다."));
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
      await resetPasswordWithVerification(email.trim(), newPassword, token);
      onSaved();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "비밀번호를 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step === "email") void sendCode();
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
    step === "email"
      ? email.trim().length > 0
      : step === "code"
        ? code.trim().length === CODE_LENGTH && !countdown.isExpired
        : newPassword.length > 0 && passwordConfirm.length > 0
  );
  const submitLabel = busy ? "처리 중…" : step === "email" ? "다음으로" : step === "code" ? "인증하기" : "비밀번호 변경";

  return createPortal(
    <div className={styles.overlay} onClick={busy ? undefined : onClose}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="비밀번호 변경"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className={styles["title-block"]}>
          <div className={styles["title-row"]}>
            <h2 className={styles.title}>비밀번호 변경</h2>
            <button type="button" className={styles.close} aria-label="닫기" disabled={busy} onClick={onClose}>
              <SvgIcon src={plusIcon} className={styles["close-icon"]} />
            </button>
          </div>
          <p className={styles.subtitle} style={{ whiteSpace: "pre-line" }}>{SUBTITLES[step]}</p>
        </div>

        <div className={styles.body}>
          {step === "email" && (
            <div className={styles.field}>
              <label htmlFor="password-change-email">이메일 주소</label>
              <input
                id="password-change-email"
                type="email"
                autoComplete="email"
                placeholder="example@email.com"
                autoFocus
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          )}
          {step === "code" && (
            <div className={styles.field}>
              <label htmlFor="password-change-code">인증번호 6자리</label>
              <div className={styles["field-control"]}>
                <input
                  id="password-change-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]+"
                  maxLength={CODE_LENGTH}
                  placeholder="XXXXXX"
                  autoFocus
                  value={code}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value)}
                />
                <span className={styles["field-timer"]} aria-live="polite">{countdown.label}</span>
              </div>
              {countdown.isExpired ? (
                <button type="button" className={styles.resend} disabled={busy} onClick={() => void sendCode()}>
                  인증번호가 만료되었습니다. 다시 받기
                </button>
              ) : (
                <p className={styles.hint}>{email.trim()} 주소로 인증번호를 보냈습니다.</p>
              )}
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          )}
          {step === "password" && (
            <div className={styles.fields}>
              <PasswordField id="password-change-new" label="새 비밀번호" value={newPassword} disabled={busy} onChange={setNewPassword} />
              <PasswordField id="password-change-confirm" label="새 비밀번호 확인" value={passwordConfirm} disabled={busy} onChange={setPasswordConfirm} />
              <p className={styles.hint}>변경하면 다른 기기의 로그인 갱신이 해제됩니다.</p>
              {error && <p className={styles.error} role="alert">{error}</p>}
            </div>
          )}

          <div className={cx(styles.footer, step === "email" && styles["is-end"])}>
            {step !== "email" && (
              <button type="button" className={styles["btn-back"]} disabled={busy} onClick={handleBack}>
                <SvgIcon src={skillBackIcon} className={styles["back-icon"]} /> 이전
              </button>
            )}
            <button type="submit" className={styles["btn-next"]} disabled={!canSubmit}>
              {submitLabel}
              {!busy && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}
