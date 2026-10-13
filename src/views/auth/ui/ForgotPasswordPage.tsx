"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { requestEmailVerification } from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { useAuthFlow } from "@/views/auth/model/AuthFlowContext";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";
import { AuthScreen, AuthScreenBlank } from "@/shared/ui/auth/AuthScreen";
import { confirmVerificationCode } from "@/views/auth/lib/confirmVerificationCode";
import { useDevelopmentVerificationCode } from "@/views/auth/model/useDevelopmentVerificationCode";
import { useExpiryCountdown } from "@/views/auth/model/useExpiryCountdown";
import { useVerificationResend } from "@/views/auth/model/useVerificationResend";
import { ResendCodePrompt } from "@/views/auth/ui/ResendCodePrompt";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthScreenBlank />}>
      <ForgotPasswordPageContent />
    </Suspense>
  );
}

function ForgotPasswordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { passwordResetDraft, setPasswordResetDraft } = useAuthFlow();
  // 설정 모달 등에서 ?email= 로 진입하면 이메일을 프리필한다.
  const [email, setEmail] = useState(
    passwordResetDraft?.email ?? searchParams.get("email") ?? ""
  );
  const [verificationCode, setVerificationCode] = useState("");
  const [isCodeStep, setIsCodeStep] = useState(Boolean(passwordResetDraft?.verificationId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRequestingVerification = isSubmitting && !isCodeStep;
  const countdown = useExpiryCountdown(passwordResetDraft?.expiresAt ?? 0);
  const { isResending, resend } = useVerificationResend({
    email: passwordResetDraft?.email ?? "",
    purpose: "password_reset",
    setErrorMessage,
    onSuccess: ({ verificationId, expiresAt }) => {
      // 응답 도착 시점의 초안에만 병합한다. 이메일을 고쳐 초안이 지워졌으면 되살리지 않는다.
      setPasswordResetDraft((current) =>
        current ? { ...current, verificationId, expiresAt } : current
      );
      setVerificationCode("");
    }
  });

  function restartVerification() {
    setPasswordResetDraft(null);
    setVerificationCode("");
    setIsCodeStep(false);
    setErrorMessage(null);
  }

  // 인증번호 발송 뒤 이메일을 고치면 기존 인증을 버리고 새 이메일로 다시 요청하게 한다.
  function handleEmailChange(nextEmail: string) {
    setEmail(nextEmail);
    if (isCodeStep) restartVerification();
  }

  async function requestVerification() {
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await requestEmailVerification(normalizedEmail, "password_reset");
      setPasswordResetDraft({
        email: normalizedEmail,
        verificationId: response.verification_id,
        expiresAt: Date.now() + response.expires_in * 1000
      });
      setIsCodeStep(true);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "이메일 인증에 실패했습니다."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function completeVerification(code: string) {
    if (isSubmitting) return;

    if (!passwordResetDraft) {
      setIsCodeStep(false);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const confirmation = await confirmVerificationCode(passwordResetDraft.verificationId, code);
      setPasswordResetDraft({
        ...passwordResetDraft,
        verificationToken: confirmation.verification_token
      });
      router.push("/reset-password");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "이메일 인증에 실패했습니다."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerificationResend() {
    if (!passwordResetDraft) return;
    await resend();
  }

  useDevelopmentVerificationCode(
    isCodeStep ? verificationCode : "",
    completeVerification
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (isCodeStep) {
      await completeVerification(verificationCode);
      return;
    }

    await requestVerification();
  }

  return (
    <AuthScreen shellModifier="password" title="비밀번호 찾기">
      <form className="auth-form" method="post" onSubmit={handleSubmit}>
        <div className="auth-field-with-error">
          <div className="auth-field-stack">
            <AuthField
              autoComplete="email"
              label="이메일 인증"
              name="email"
              onChange={(event) => handleEmailChange(event.target.value)}
              placeholder="example@email.com"
              readOnly={isSubmitting}
              type="email"
              value={email}
            />
            {/* Figma 시안처럼 인증번호 칸을 처음부터 두고, 발송 전에는 입력과 타이머를 막는다. */}
            <AuthField
              label="인증번호"
              name="verificationCode"
              onChange={(event) => setVerificationCode(event.target.value)}
              placeholder="code"
              readOnly={!isCodeStep}
              timer={isCodeStep ? countdown.label : undefined}
              value={verificationCode}
            />
          </div>
          {isRequestingVerification ? <p className="auth-prompt" role="status">인증번호를 발송하고 있습니다.</p> : null}
          {errorMessage ? <AuthError>{errorMessage}</AuthError> : null}
        </div>
        <AuthSubmitButton disabled={isSubmitting}>
          {isRequestingVerification ? "발송 중" : "인증 요청"}
        </AuthSubmitButton>
      </form>
      <ResendCodePrompt
        disabled={!isCodeStep || !countdown.canResend || isResending}
        isResending={isResending}
        onResend={handleVerificationResend}
      />
    </AuthScreen>
  );
}
