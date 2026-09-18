"use client";

import { ChevronRight } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { activateMfa, disableMfa, type MfaRegistration } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/errors";
import { useEscapeKey } from "@/shared/lib/useEscapeKey";
import { copyIcon, downloadIcon, plusIcon, skillBackIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./AccountFlowModal.module.css";

const CODE_LENGTH = 6;

/** 계정 흐름 모달 공통 셸: 제목·부제·닫기 버튼. */
function FlowModal({
  title,
  stepLabel,
  subtitle,
  ariaLabel,
  canClose,
  onClose,
  onSubmit,
  children
}: {
  title: string;
  stepLabel?: string;
  subtitle: ReactNode;
  ariaLabel: string;
  canClose: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  useEscapeKey(canClose, onClose);
  return createPortal(
    <div className={styles.overlay} onClick={canClose ? onClose : undefined}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className={styles["title-block"]}>
          <div className={styles["title-row"]}>
            <div className={styles["title-stack"]}>
              {stepLabel && <p className={styles["step-label"]}>{stepLabel}</p>}
              <h2 className={styles.title}>{title}</h2>
            </div>
            <button type="button" className={styles.close} aria-label="닫기" disabled={!canClose} onClick={onClose}>
              <SvgIcon src={plusIcon} className={styles["close-icon"]} />
            </button>
          </div>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <div className={styles.body}>{children}</div>
      </form>
    </div>,
    document.body
  );
}

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
      setError(getErrorMessage(cause, "인증 코드를 확인하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(registration.recovery_codes.join("\n"));
      setMessage("복구 코드를 복사했습니다.");
      setError(null);
    } catch {
      setError("복사하지 못했습니다. 다운로드하거나 직접 보관해 주세요.");
    }
  }

  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob(["Fruition 복구 코드\n\n", registration.recovery_codes.join("\n")], { type: "text/plain;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "fruition-recovery-codes.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("복구 코드 다운로드를 시작했습니다.");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step === "connect") setStep("verify");
    else if (step === "verify") void verify();
    else if (codesSaved) onClose();
  }

  const meta = {
    connect: { label: "STEP 1/3", title: "인증 앱 연결", subtitle: "Google Authenticator 등 인증 앱에서 QR코드를 스캔해 주세요." },
    verify: { label: "STEP 2/3", title: "인증번호 확인", subtitle: "인증 앱에 표시된 6자리 코드를 입력해 주세요." },
    recovery: {
      label: "STEP 3/3",
      title: "복구 코드 보관",
      subtitle: <>인증 앱을 사용할 수 없을 때 로그인할 수 있도록 복구 코드를 보관해 주세요.<br />각 코드는 한 번만 사용할 수 있으며, 이 화면을 닫으면 볼 수 없습니다.</>
    }
  }[step];
  // 복구 코드 단계는 보관 확인 전에 닫을 수 없다.
  const canClose = !busy && step !== "recovery";

  return (
    <FlowModal
      title={meta.title}
      stepLabel={meta.label}
      subtitle={meta.subtitle}
      ariaLabel="다단계 인증 설정"
      canClose={canClose}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {step === "connect" && (
        <div className={styles["qr-block"]}>
          <div className={styles.qr}>
            <QRCodeSVG value={registration.otpauth_uri} size={184} marginSize={0} level="M" role="img" aria-label="인증 앱 등록 QR코드" />
          </div>
          <div className={styles.field}>
            <div className={styles["field-head"]}>
              <label htmlFor="mfa-secret">인증 앱 설정 키</label>
              <p className={styles["field-desc"]}>QR 인증이 되지 않는다면 인증 앱에서 직접 계정을 추가하고, 키 유형을 시간 기반으로 선택해 주세요.</p>
            </div>
            <input id="mfa-secret" readOnly value={registration.secret} onFocus={(event) => event.target.select()} />
          </div>
        </div>
      )}
      {step === "verify" && (
        <div className={styles.field}>
          <div className={styles["field-head"]}>
            <label htmlFor="mfa-code">코드 6자리</label>
            <p className={styles["field-desc"]}>방금 사용한 코드라면 다음 코드가 표시된 뒤 입력해 주세요.</p>
          </div>
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={CODE_LENGTH}
            placeholder="XXXXXX"
            autoFocus
            value={code}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      )}
      {step === "recovery" && (
        <div className={styles.field}>
          <div className={styles["field-title-row"]}>
            <label>복구 코드</label>
            <div className={styles["icon-actions"]}>
              <button type="button" className={styles["icon-button"]} aria-label="복구 코드 복사" onClick={() => void copyCodes()}>
                <SvgIcon src={copyIcon} />
              </button>
              <button type="button" className={styles["icon-button"]} aria-label="복구 코드 다운로드" onClick={downloadCodes}>
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
            복구 코드를 안전한 곳에 보관했습니다.
          </label>
          {message && <p className={styles.status} role="status">{message}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      )}

      <div className={cx(styles.footer, step !== "verify" && styles["is-end"])}>
        {step === "verify" && (
          <button type="button" className={styles["btn-back"]} disabled={busy} onClick={() => { setError(null); setStep("connect"); }}>
            <SvgIcon src={skillBackIcon} className={styles["back-icon"]} /> 이전
          </button>
        )}
        <button
          type="submit"
          className={styles["btn-next"]}
          disabled={busy || (step === "verify" && code.trim().length !== CODE_LENGTH) || (step === "recovery" && !codesSaved)}
        >
          {busy ? "확인 중…" : step === "connect" ? "다음으로" : step === "verify" ? "인증하기" : "설정 완료"}
          {!busy && step !== "recovery" && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
        </button>
      </div>
    </FlowModal>
  );
}

/** 다단계 인증 해제 모달 (Figma 1127:5158). */
export function MfaDisableModal({ onDisabled, onClose }: { onDisabled: () => void; onClose: () => void }) {
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
      setError(getErrorMessage(cause, "다단계 인증을 해제하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlowModal
      title="다단계 인증 해제"
      subtitle="인증 앱의 코드 또는 복구 코드로 본인임을 확인해 주세요."
      ariaLabel="다단계 인증 해제"
      canClose={!busy}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className={styles.field}>
        <div className={styles["field-head"]}>
          <label htmlFor="mfa-disable-code">인증 코드 또는 복구 코드</label>
          <p className={styles["field-desc"]}>방금 사용한 코드라면 다음 코드가 표시된 뒤 입력해 주세요.</p>
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
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <div className={cx(styles.footer, styles["is-end"])}>
        <button type="submit" className={cx(styles["btn-next"], styles["is-dim"])} disabled={busy || !code.trim()}>
          {busy ? "확인 중…" : "다단계 인증 해제"}
          {!busy && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
        </button>
      </div>
    </FlowModal>
  );
}
