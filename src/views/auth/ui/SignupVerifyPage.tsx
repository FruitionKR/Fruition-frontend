"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { buildConsentBody, confirmEmailVerification, consentErrorMessage, loginWithEmail, signupWithEmail } from "@/entities/user";
import { LEGAL_TERMS_VERSION } from "@/shared/config/legal";
import { saveAccessToken, takeAfterLoginPath } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { useAuthFlow } from "@/views/auth/model/AuthFlowContext";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/AuthControls";
import { AuthScreen, AuthScreenBlank } from "@/shared/ui/AuthScreen";
import { useDevelopmentVerificationCode } from "@/views/auth/lib/useDevelopmentVerificationCode";
import { useExpiryCountdown } from "@/views/auth/lib/useExpiryCountdown";
import { useVerificationResend } from "@/views/auth/lib/useVerificationResend";
import { ResendCodePrompt } from "@/views/auth/ui/ResendCodePrompt";
import { MfaLoginForm } from "./MfaLoginForm";

export default function SignupVerificationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signupDraft, setSignupDraft } = useAuthFlow();
  const [verificationCode, setVerificationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const countdown = useExpiryCountdown(signupDraft?.expiresAt ?? 0);
  const draft = signupDraft;
  const isRequestingVerification = Boolean(draft && !draft.verificationId && !draft.verificationRequestError);
  const { isResending, resend } = useVerificationResend({
    email: draft?.email ?? "",
    purpose: "signup",
    setErrorMessage,
    onSuccess: ({ verificationId, expiresAt }) => {
      // 응답 도착 시점의 초안에만 병합한다. 이탈 등으로 초안이 사라졌으면 되살리지 않는다.
      setSignupDraft((current) =>
        current
          ? { ...current, verificationId, expiresAt, verificationRequestError: undefined }
          : current
      );
      setVerificationCode("");
    }
  });

  useEffect(() => {
    if (!signupDraft) router.replace("/signup");
  }, [router, signupDraft]);

  useDevelopmentVerificationCode(verificationCode, completeVerification);

  if (!draft) {
    return <AuthScreenBlank />;
  }

  async function completeVerification(code: string) {
    if (isSubmitting || !draft?.verificationId) return;
    // 가입 화면이 필수 동의 없이는 넘어오지 않지만, 초안이 바뀌었을 수 있어 요청 직전에 다시 확인한다.
    const consent = buildConsentBody(draft.consent, LEGAL_TERMS_VERSION);
    if (!consent) {
      setErrorMessage("약관 동의가 필요합니다. 가입 화면에서 다시 동의해 주세요.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const confirmation = await confirmEmailVerification(
        draft.verificationId,
        code.trim()
      );
      await signupWithEmail(
        draft.email,
        draft.password,
        draft.nickname,
        confirmation.verification_token,
        consent
      );
      const tokens = await loginWithEmail(draft.email, draft.password);
      if (tokens.mfa_required) {
        setMfaToken(tokens.mfa_token);
        return;
      }
      saveAccessToken(tokens.access_token);
      queryClient.clear();
      router.replace(takeAfterLoginPath());
    } catch (error: unknown) {
      // CONSENT_REQUIRED(약관 버전 불일치 등)는 동의만 고쳐 다시 보낼 수 있다. 인증 토큰은 소비되지 않는다.
      setErrorMessage(consentErrorMessage(error, getErrorMessage(error, "회원가입에 실패했습니다.")));
      setIsSubmitting(false);
    }
  }

  async function handleVerificationConfirm(event: React.FormEvent) {
    event.preventDefault();
    await completeVerification(verificationCode);
  }

  async function handleVerificationResend() {
    if (!draft) return;
    await resend();
  }

  if (mfaToken) return (
    <AuthScreen shellModifier="verification" title="다단계 인증">
      <MfaLoginForm token={mfaToken} onCancel={() => router.replace("/login")} />
    </AuthScreen>
  );

  return (
    <AuthScreen shellModifier="verification" title="회원가입">
      <form className="auth-form" method="post" onSubmit={handleVerificationConfirm}>
        <div className="auth-field-with-error">
          <AuthField
            label="인증번호"
            name="verificationCode"
            onChange={(event) => setVerificationCode(event.target.value)}
            placeholder="code"
            readOnly={isRequestingVerification || Boolean(draft.verificationRequestError)}
            timer={draft.expiresAt ? countdown.label : undefined}
            value={verificationCode}
          />
          {isRequestingVerification ? <p className="auth-prompt" role="status">인증번호를 발송하고 있습니다.</p> : null}
          {draft.verificationRequestError ? <AuthError>{draft.verificationRequestError}</AuthError> : null}
          {errorMessage ? <AuthError>{errorMessage}</AuthError> : null}
        </div>
        <AuthSubmitButton disabled={isSubmitting || !draft.verificationId}>
          {isRequestingVerification ? "발송 중" : "인증 확인"}
        </AuthSubmitButton>
      </form>
      <ResendCodePrompt
        disabled={!countdown.isExpired || isResending}
        isResending={isResending}
        onResend={handleVerificationResend}
      />
      <p className="auth-prompt">이메일을 다시 입력하시겠어요?<button onClick={() => router.push("/signup")} type="button">이전으로</button></p>
    </AuthScreen>
  );
}
