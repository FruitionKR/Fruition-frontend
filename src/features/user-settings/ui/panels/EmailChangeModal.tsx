"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { changeEmail, confirmEmailVerification, requestEmailVerification, ME_QUERY_KEY, SESSIONS_QUERY_KEY } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/errors";
import styles from "./AccountFlowModal.module.css";
import { CODE_LENGTH, FlowBackButton, FlowError, FlowModal, FlowNextButton, VerificationCodeInput } from "./FlowModal";

/**
 * 이메일 변경 2단계 모달.
 * 1단계: 변경할 이메일 입력 → 인증번호 발송. 2단계: 인증번호 6자리 확인 → 이메일 변경.
 */
export function EmailChangeModal({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const isCodeStep = verificationId !== null;

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function sendCode() {
    if (busy || Date.now() < retryAt) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestEmailVerification(email.trim(), "email_change");
      setVerificationId(result.verification_id);
      setToken(null);
      setCode("");
      setNow(Date.now());
      setRetryAt(Date.now() + result.retry_after * 1000);
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "인증번호를 보내지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndChange() {
    if (busy || !verificationId) return;
    setBusy(true);
    setError(null);
    try {
      // 확정 요청만 실패했다면 이미 확인한 토큰으로 재시도한다.
      const verifiedToken = token ?? (await confirmEmailVerification(verificationId, code.trim())).verification_token;
      setToken(verifiedToken);
      const updated = await changeEmail(email.trim(), verifiedToken);
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      onSaved();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "이메일을 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isCodeStep) void verifyAndChange();
    else void sendCode();
  }

  // 2단계의 '이전'은 이메일 입력으로 돌아간다.
  function handleBack() {
    if (busy) return;
    setVerificationId(null);
    setToken(null);
    setCode("");
    setError(null);
  }

  const canSubmit = isCodeStep
    ? code.trim().length === CODE_LENGTH && !busy
    : email.trim().length > 0 && !busy && retrySeconds === 0;

  return (
    <FlowModal
      title="이메일 변경"
      subtitle={isCodeStep ? "인증번호 6자리를 입력하여 이메일을 인증하세요." : "이 계정에 로그인할 때 사용할 이메일을 변경합니다."}
      ariaLabel="이메일 변경"
      canClose={!busy}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {isCodeStep ? (
        <div className={styles.field}>
          <label htmlFor="email-change-code">인증번호 6자리</label>
          <VerificationCodeInput id="email-change-code" value={code} disabled={busy || Boolean(token)} onChange={setCode} />
          <p className={styles.hint}>{email.trim()} 주소로 인증번호를 보냈습니다.</p>
          <button type="button" className={styles.resend} disabled={busy || retrySeconds > 0} onClick={() => void sendCode()}>
            {retrySeconds > 0 ? `${retrySeconds}초 후 재전송 가능` : "인증번호 재전송"}
          </button>
          <FlowError error={error} />
        </div>
      ) : (
        <div className={styles.field}>
          <label htmlFor="email-change-email">변경할 이메일 주소</label>
          <input
            id="email-change-email"
            type="email"
            autoComplete="email"
            maxLength={255}
            placeholder="example@email.com"
            autoFocus
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className={styles.hint}>이메일을 변경하면 다른 기기의 로그인 갱신이 해제됩니다.</p>
          <FlowError error={error} />
        </div>
      )}

      <div className={cx(styles.footer, !isCodeStep && styles["is-end"])}>
        {isCodeStep && <FlowBackButton disabled={busy} onClick={handleBack} />}
        <FlowNextButton disabled={!canSubmit} showChevron={!busy}>
          {busy ? "처리 중…" : isCodeStep ? "인증하기" : retrySeconds > 0 ? `${retrySeconds}초 후 가능` : "변경하기"}
        </FlowNextButton>
      </div>
    </FlowModal>
  );
}
