"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  checkEmailAvailability,
  EMPTY_CONSENT,
  isSignupConsentReady,
  registeredEmailErrorMessage,
  requestEmailVerification,
  signupAvailabilityMessage,
  verificationWaitSeconds,
  type ConsentChoices
} from "@/entities/user";
import { ConsentForm } from "@/features/legal-consent";
import { LEGAL_PAGES_ENABLED } from "@/shared/config/legal";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getPasswordPolicyError } from "@/shared/lib/passwordPolicy";
import { useTypedFormValues } from "@/shared/hooks/useTypedFormValues";
import { useAuthFlow } from "@/views/auth/model/AuthFlowContext";
import { useExpiryCountdown } from "@/views/auth/model/useExpiryCountdown";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";
import { AuthScreen } from "@/shared/ui/auth/AuthScreen";
import { LoginLinkPrompt } from "@/views/auth/ui/LoginLinkPrompt";
import { verificationWaitMessage } from "@/views/auth/lib/verificationWaitMessage";

export default function SignupPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tShared = useTranslations("shared");
  const waitMessage = (seconds: number) => {
    const { key, values } = verificationWaitMessage(seconds);
    return t(`verification.wait.${key}`, values);
  };
  const { signupDraft, setSignupDraft, isCurrentSignupVerificationRequest } = useAuthFlow();
  const [nickname, setNickname] = useState(signupDraft?.nickname ?? "");
  const [email, setEmail] = useState(signupDraft?.email ?? "");
  const [password, setPassword] = useState(signupDraft?.password ?? "");
  const [consent, setConsent] = useState<ConsentChoices>(signupDraft?.consent ?? EMPTY_CONSENT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useTypedFormValues({ nickname: setNickname, email: setEmail, password: setPassword });
  const isDraftEmail = signupDraft?.email === email.trim().toLowerCase();
  const draftError = isDraftEmail ? signupDraft.verificationRequestError ?? null : null;
  // 인증번호 요청이 시도 제한에 걸렸으면 남은 시간을 세고, 그동안은 같은 주소로 다시 보내지 않는다.
  const retryAt = isDraftEmail ? signupDraft.verificationRetryAt ?? 0 : 0;
  const retryCountdown = useExpiryCountdown(retryAt);
  const isWaitingRetry = retryAt > Date.now();
  const visibleError = errorMessage
    ?? (isWaitingRetry ? waitMessage(Math.max(1, retryCountdown.seconds)) : retryAt > 0 ? null : draftError);

  async function handleVerificationRequest(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting || isWaitingRetry) return;

    const passwordError = getPasswordPolicyError(password, tShared);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }
    // 버튼이 꺼져 있어도 Enter 제출은 들어올 수 있다. 필수 동의 없이는 인증 요청을 시작하지 않는다.
    // 약관 공개 플래그가 꺼져 있으면 동의를 묻지 않는다(서버 LEGAL_CONSENT_REQUIRED=false와 짝).
    if (!isSignupConsentReady(LEGAL_PAGES_ENABLED, consent)) {
      setErrorMessage(t("signup.consentRequired"));
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      // 소셜 가입 계정이 있으면 available=false와 함께 oauth_providers가 와서 인증 요청이 409로 거절된다.
      // 인증 메일을 보내기 전에 그 소셜 로그인 뒤 연동하도록 먼저 안내한다(access #31).
      const blockedMessage = signupAvailabilityMessage(await checkEmailAvailability(normalizedEmail), tShared);
      if (blockedMessage) {
        setErrorMessage(blockedMessage);
        setIsSubmitting(false);
        return;
      }
    } catch (error: unknown) {
      const waitSeconds = verificationWaitSeconds(error);
      setErrorMessage(waitSeconds !== null ? waitMessage(waitSeconds) : getErrorMessage(error, t("signup.emailCheckFailed"), tShared));
      setIsSubmitting(false);
      return;
    }

    const verificationRequestId = crypto.randomUUID();
    const pendingDraft = {
      nickname: nickname.trim(),
      email: normalizedEmail,
      password,
      consent,
      verificationId: "",
      expiresAt: 0,
      verificationRequestId
    };
    setSignupDraft(pendingDraft);
    router.push("/signup/verify");

    try {
      const response = await requestEmailVerification(normalizedEmail, "signup");
      if (!isCurrentSignupVerificationRequest(verificationRequestId)) return;
      setSignupDraft({
        ...pendingDraft,
        verificationId: response.verification_id,
        expiresAt: Date.now() + response.expires_in * 1000
      });
    } catch (error: unknown) {
      if (!isCurrentSignupVerificationRequest(verificationRequestId)) return;
      // 409 EMAIL_REGISTERED_WITH_OAUTH(중복 확인과 요청 사이에 소셜 가입이 끝난 경우)도 같은 로그인·연동 안내로 돌아간다.
      const waitSeconds = verificationWaitSeconds(error);
      setSignupDraft({
        ...pendingDraft,
        verificationRequestError: waitSeconds !== null
          ? waitMessage(waitSeconds)
          : registeredEmailErrorMessage(error, tShared) ?? getErrorMessage(error, t("signup.verificationRequestFailed"), tShared),
        verificationRetryAt: waitSeconds !== null ? Date.now() + waitSeconds * 1000 : undefined
      });
      setIsSubmitting(false);
      router.replace("/signup");
    }
  }

  return (
    <AuthScreen title={t("signup.title")}>
      <form className="auth-form" method="post" onSubmit={handleVerificationRequest} ref={formRef}>
        <div className="auth-field-with-error">
          <div className="auth-field-stack">
            <AuthField label={t("fields.nickname")} name="nickname" onChange={(event) => setNickname(event.target.value)} placeholder="name" value={nickname} />
            <AuthField autoComplete="email" label={t("fields.email")} name="email" onChange={(event) => setEmail(event.target.value)} placeholder="example@email.com" type="email" value={email} />
            <AuthField autoComplete="new-password" label={t("fields.password")} name="password" onChange={(event) => setPassword(event.target.value)} placeholder="password" type="password" value={password} />
            {LEGAL_PAGES_ENABLED ? <ConsentForm disabled={isSubmitting} idPrefix="signup-consent" onChange={setConsent} value={consent} /> : null}
          </div>
          {visibleError ? <AuthError>{visibleError}</AuthError> : null}
        </div>
        {/* 동의 UI가 켜져 있으면 필수 동의(만 18세·이용약관)를 모두 체크해야 가입을 시작할 수 있다. */}
        <AuthSubmitButton disabled={isSubmitting || isWaitingRetry || !isSignupConsentReady(LEGAL_PAGES_ENABLED, consent)}>{t("signup.submit")}</AuthSubmitButton>
      </form>
      <LoginLinkPrompt />
    </AuthScreen>
  );
}
