"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkEmailAvailability,
  EMPTY_CONSENT,
  isSignupConsentReady,
  registeredEmailErrorMessage,
  requestEmailVerification,
  signupAvailabilityMessage,
  type ConsentChoices
} from "@/entities/user";
import { ConsentForm } from "@/features/legal-consent";
import { LEGAL_PAGES_ENABLED } from "@/shared/config/legal";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { getPasswordPolicyError } from "@/shared/lib/passwordPolicy";
import { useAuthFlow } from "@/views/auth/model/AuthFlowContext";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/auth/AuthControls";
import { AuthScreen } from "@/shared/ui/auth/AuthScreen";
import { LoginLinkPrompt } from "@/views/auth/ui/LoginLinkPrompt";

export default function SignupPage() {
  const router = useRouter();
  const { signupDraft, setSignupDraft, isCurrentSignupVerificationRequest } = useAuthFlow();
  const [nickname, setNickname] = useState(signupDraft?.nickname ?? "");
  const [email, setEmail] = useState(signupDraft?.email ?? "");
  const [password, setPassword] = useState(signupDraft?.password ?? "");
  const [consent, setConsent] = useState<ConsentChoices>(signupDraft?.consent ?? EMPTY_CONSENT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const draftError = signupDraft?.email === email.trim().toLowerCase()
    ? signupDraft.verificationRequestError ?? null
    : null;
  const visibleError = errorMessage ?? draftError;

  async function handleVerificationRequest(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }
    // 버튼이 꺼져 있어도 Enter 제출은 들어올 수 있다. 필수 동의 없이는 인증 요청을 시작하지 않는다.
    // 약관 공개 플래그가 꺼져 있으면 동의를 묻지 않는다(서버 LEGAL_CONSENT_REQUIRED=false와 짝).
    if (!isSignupConsentReady(LEGAL_PAGES_ENABLED, consent)) {
      setErrorMessage("만 18세 이상 확인과 이용약관 동의는 필수입니다.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      // 소셜 가입 계정이 있으면 available=false와 함께 oauth_providers가 와서 인증 요청이 409로 거절된다.
      // 인증 메일을 보내기 전에 그 소셜 로그인 뒤 연동하도록 먼저 안내한다(access #31).
      const blockedMessage = signupAvailabilityMessage(await checkEmailAvailability(normalizedEmail));
      if (blockedMessage) {
        setErrorMessage(blockedMessage);
        setIsSubmitting(false);
        return;
      }
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "이메일 중복 확인에 실패했습니다."));
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
      setSignupDraft({
        ...pendingDraft,
        verificationRequestError: registeredEmailErrorMessage(error) ?? getErrorMessage(error, "인증번호 요청에 실패했습니다.")
      });
      setIsSubmitting(false);
      router.replace("/signup");
    }
  }

  return (
    <AuthScreen title="회원가입">
      <form className="auth-form" method="post" onSubmit={handleVerificationRequest}>
        <div className="auth-field-with-error">
          <div className="auth-field-stack">
            <AuthField label="닉네임" name="nickname" onChange={(event) => setNickname(event.target.value)} placeholder="name" value={nickname} />
            <AuthField autoComplete="email" label="이메일" name="email" onChange={(event) => setEmail(event.target.value)} placeholder="example@email.com" type="email" value={email} />
            <AuthField autoComplete="new-password" label="비밀번호" name="password" onChange={(event) => setPassword(event.target.value)} placeholder="password" type="password" value={password} />
            {LEGAL_PAGES_ENABLED ? <ConsentForm disabled={isSubmitting} idPrefix="signup-consent" onChange={setConsent} value={consent} /> : null}
          </div>
          {visibleError ? <AuthError>{visibleError}</AuthError> : null}
        </div>
        {/* 동의 UI가 켜져 있으면 필수 동의(만 18세·이용약관)를 모두 체크해야 가입을 시작할 수 있다. */}
        <AuthSubmitButton disabled={isSubmitting || !isSignupConsentReady(LEGAL_PAGES_ENABLED, consent)}>인증 요청</AuthSubmitButton>
      </form>
      <LoginLinkPrompt />
    </AuthScreen>
  );
}
