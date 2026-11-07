"use client";

import { useDevelopmentVerificationCode } from "@/shared/hooks/useDevelopmentVerificationCode";
import { verificationCodeLabel } from "@/shared/lib/developmentVerificationCode";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildEmailChangeBody,
  changeEmail,
  confirmEmailVerification,
  emailChangeFailure,
  emailCodeRequestFailureMessage,
  getOAuthAuthorizationUrl,
  isSameEmail,
  requestEmailVerification,
  oauthProviderName,
  ME_QUERY_KEY,
  SESSIONS_QUERY_KEY,
  type OAuthProvider,
  type UserMeResponse
} from "@/entities/user";
import { setAfterLoginPath } from "@/shared/lib/authSessionStorage";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { saveSettingsResume } from "../../lib/settingsResume";
import { useMfaRequirement } from "../../model/useMfaRequirement";
import styles from "./AccountFlowModal.module.css";
import { FlowBackButton, FlowError, AccountFlowModal, FlowNextButton, isEmailCodeComplete, VerificationCodeInput } from "./AccountFlowModal";

type Step = "email" | "code" | "reauth" | "done";

/**
 * 이메일 변경 모달.
 * 1단계: 변경할 이메일 입력 → 인증번호 발송. 2단계: 인증번호 6자리 확인.
 * 3단계: 본인 확인(비밀번호, MFA를 켰으면 인증 코드) → 이메일 변경. 소셜 전용 계정은 비밀번호를 비워 두고,
 * 10분 안에 직접 로그인하지 않았으면 소셜 재로그인을 안내한다. 완료하면 기존 이메일로 알림이 갔음을 알린다.
 */
export function EmailChangeModal({
  me,
  onSaved,
  onClose
}: {
  me: UserMeResponse;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  const { isMfaEnabled, requireMfa } = useMfaRequirement();
  const [previousEmail] = useState(me.email);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const blockedSeconds = Math.max(0, Math.ceil((blockedUntil - now) / 1000));
  const tickUntil = Math.max(retryAt, blockedUntil);
  const linkedProviders = (me.oauth_providers ?? []) as OAuthProvider[];

  useEffect(() => {
    if (!tickUntil) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= tickUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tickUntil]);

  async function sendCode() {
    if (busy || Date.now() < retryAt) return;
    // 인증번호 요청은 로그인 없이 받는 요청이라 지금 쓰는 주소도 '다른 계정이 사용 중'(409)으로 거절된다. 보내기 전에 막는다.
    if (isSameEmail(email, me.email)) {
      setError(t("emailChange.sameEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestEmailVerification(email.trim(), "email_change");
      setVerificationId(result.verification_id);
      setToken(null);
      setCode("");
      setStep("code");
      setNow(Date.now());
      setRetryAt(Date.now() + result.retry_after * 1000);
    } catch (cause: unknown) {
      // 다른 계정이 쓰는 주소(409 DUPLICATE_EMAIL)는 변경 단계와 같은 문구로 알리고 이메일 입력에 머문다.
      setError(emailCodeRequestFailureMessage(cause) ?? getErrorMessage(cause, t("common.sendCodeFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (busy || !verificationId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmEmailVerification(verificationId, code.trim());
      setToken(result.verification_token);
      setStep("reauth");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, t("common.verifyCodeFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function submitChange() {
    if (busy || !token || Date.now() < blockedUntil) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await changeEmail(buildEmailChangeBody({ newEmail: email, verificationToken: token, password, mfaCode }));
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      setStep("done");
    } catch (cause: unknown) {
      recoverFrom(cause);
    } finally {
      setBusy(false);
    }
  }

  /** 서버 error.code에 따라 고칠 입력만 다시 받는다. 본인 확인 실패는 같은 인증 토큰을 그대로 쓴다. */
  function recoverFrom(cause: unknown) {
    const failure = emailChangeFailure(cause, t("emailChange.failed"));
    setError(failure.message);
    setNeedsReauth(failure.recovery === "relogin");
    if (failure.recovery === "email") resetToEmail();
    if (failure.recovery === "code") {
      setToken(null);
      setCode("");
      setStep("code");
    }
    if (failure.recovery === "password") setPassword("");
    if (failure.recovery === "mfa") {
      setMfaCode("");
      requireMfa();
    }
    if (failure.recovery === "wait" && failure.retryAfter) {
      setNow(Date.now());
      setBlockedUntil(Date.now() + failure.retryAfter * 1000);
    }
  }

  /** 비밀번호가 없는 소셜 계정의 본인 확인. 로그인을 마치면 설정의 이메일 변경 창으로 돌아온다. */
  function reloginWith(provider: OAuthProvider) {
    saveSettingsResume("email-change");
    setAfterLoginPath(`${window.location.pathname}${window.location.search}`);
    window.location.assign(getOAuthAuthorizationUrl(provider));
  }

  // 개발 환경의 고정 인증번호(9700)는 가입·비밀번호 찾기처럼 입력하면 바로 확인한다.
  useDevelopmentVerificationCode(step === "code" ? code : "", () => verifyCode());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (step === "done") onSaved();
    else if (step === "email") void sendCode();
    else if (step === "code") void verifyCode();
    else void submitChange();
  }

  function resetToEmail() {
    setVerificationId(null);
    setToken(null);
    setCode("");
    setStep("email");
  }

  // '이전'은 이메일 입력으로 돌아간다. 주소를 바꾸면 인증을 다시 받아야 한다.
  function handleBack() {
    if (busy) return;
    resetToEmail();
    setError(null);
  }

  const canSubmit = !busy && (
    step === "done" ? true
    : step === "email" ? email.trim().length > 0 && retrySeconds === 0
    : step === "code" ? isEmailCodeComplete(code)
    : blockedSeconds === 0 && (!isMfaEnabled || mfaCode.trim().length > 0)
  );
  const submitLabel = busy ? t("common.processing")
    : step === "email" ? (retrySeconds > 0 ? t("common.secondsLeft", { seconds: retrySeconds }) : t("emailChange.submitEmail"))
    : step === "code" ? t("common.verify")
    : step === "reauth" ? (blockedSeconds > 0 ? t("common.secondsLeft", { seconds: blockedSeconds }) : t("emailChange.submitChange"))
    : t("common.confirm");
  const subtitle = step === "email" ? t("emailChange.emailSubtitle")
    : step === "code" ? t("common.codeStepSubtitle")
    : step === "reauth" ? (isMfaEnabled ? t("emailChange.reauthSubtitleMfa") : t("emailChange.reauthSubtitle"))
    : <span role="status">{t("emailChange.doneSubtitle", { email: email.trim() })}</span>;

  return (
    <AccountFlowModal
      title={t("emailChange.title")}
      subtitle={subtitle}
      ariaLabel={t("emailChange.title")}
      canClose={!busy}
      // 변경을 마친 뒤에는 닫아도 완료로 처리한다.
      onClose={step === "done" ? onSaved : onClose}
      onSubmit={handleSubmit}
    >
      {step === "email" && (
        <div className={styles.field}>
          <label htmlFor="email-change-email">{t("emailChange.newEmailLabel")}</label>
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
          <p className={styles.hint}>{t("emailChange.sessionsHint")}</p>
          <FlowError error={error} />
        </div>
      )}

      {step === "code" && (
        <div className={styles.field}>
          <label htmlFor="email-change-code">{verificationCodeLabel()}</label>
          <VerificationCodeInput id="email-change-code" value={code} disabled={busy} onChange={setCode} />
          <p className={styles.hint}>{t("common.codeSentTo", { email: email.trim() })}</p>
          <button type="button" className={styles.resend} disabled={busy || retrySeconds > 0} onClick={() => void sendCode()}>
            {retrySeconds > 0 ? t("emailChange.resendIn", { seconds: retrySeconds }) : t("emailChange.resend")}
          </button>
          <FlowError error={error} />
        </div>
      )}

      {step === "reauth" && (
        <div className={styles.fields}>
          <div className={styles.field}>
            <div className={styles["field-head"]}>
              <label htmlFor="email-change-password">{t("emailChange.currentPassword")}</label>
              {linkedProviders.length > 0 && (
                <p className={styles["field-desc"]}>{t("common.socialOnlyPasswordHint")}</p>
              )}
            </div>
            <input
              id="email-change-password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              placeholder="password"
              autoFocus
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {isMfaEnabled && (
            <div className={styles.field}>
              <label htmlFor="email-change-mfa">{t("common.mfaCodeLabel")}</label>
              <input
                id="email-change-mfa"
                autoComplete="one-time-code"
                maxLength={64}
                placeholder="XXXXXX"
                value={mfaCode}
                disabled={busy}
                onChange={(event) => setMfaCode(event.target.value)}
              />
            </div>
          )}
          {needsReauth && linkedProviders.length > 0 && (
            <div className={styles.field}>
              <p className={styles["field-desc"]}>{t("emailChange.reloginHint")}</p>
              <div className={styles["provider-row"]}>
                {linkedProviders.map((provider) => (
                  <button key={provider} type="button" className={styles["btn-back"]} disabled={busy} onClick={() => reloginWith(provider)}>
                    {t("common.reloginWith", { provider: oauthProviderName(provider) })}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className={styles.hint}>{t("emailChange.changeTo", { email: email.trim() })}</p>
          <FlowError error={error} />
        </div>
      )}

      {step === "done" && (
        <div className={styles.field}>
          <p className={styles.hint}>
            {t("emailChange.doneHint", { email: previousEmail })}
          </p>
        </div>
      )}

      <div className={cx(styles.footer, (step === "email" || step === "done") && styles["is-end"])}>
        {(step === "code" || step === "reauth") && <FlowBackButton disabled={busy} onClick={handleBack} />}
        <FlowNextButton disabled={!canSubmit} showChevron={!busy && step !== "done"}>
          {submitLabel}
        </FlowNextButton>
      </div>
    </AccountFlowModal>
  );
}
