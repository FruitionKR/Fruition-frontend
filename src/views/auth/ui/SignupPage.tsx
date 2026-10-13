"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkEmailAvailability,
  EMPTY_CONSENT,
  isConsentComplete,
  requestEmailVerification,
  signupOAuthConflictMessage,
  type ConsentChoices
} from "@/entities/user";
import { ConsentForm } from "@/features/legal-consent";
import { getErrorMessage } from "@/shared/lib/errors";
import { getPasswordPolicyError } from "@/shared/lib/passwordPolicy";
import { useAuthFlow } from "@/views/auth/model/AuthFlowContext";
import { AuthError, AuthField, AuthSubmitButton } from "@/shared/ui/AuthControls";
import { AuthScreen } from "@/shared/ui/AuthScreen";

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
    if (!isConsentComplete(consent)) {
      setErrorMessage("만 18세 이상 확인과 이용약관 동의는 필수입니다.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const availability = await checkEmailAvailability(normalizedEmail);
      if (!availability.available) {
        setErrorMessage("이미 가입된 이메일입니다.");
        setIsSubmitting(false);
        return;
      }
      // 서버는 소셜 가입 이메일도 available로 돌려주므로, 인증 메일을 보내기 전에 여기서 막는다.
      const oauthConflict = signupOAuthConflictMessage(availability.oauth_providers ?? []);
      if (oauthConflict) {
        setErrorMessage(oauthConflict);
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
      setSignupDraft({
        ...pendingDraft,
        verificationRequestError: getErrorMessage(error, "인증번호 요청에 실패했습니다.")
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
            <ConsentForm disabled={isSubmitting} idPrefix="signup-consent" onChange={setConsent} value={consent} />
          </div>
          {visibleError ? <AuthError>{visibleError}</AuthError> : null}
        </div>
        {/* 필수 동의(만 18세·이용약관)를 모두 체크해야 가입을 시작할 수 있다. */}
        <AuthSubmitButton disabled={isSubmitting || !isConsentComplete(consent)}>인증 요청</AuthSubmitButton>
      </form>
      <p className="auth-prompt">이미 아이디가 있으신가요?<button onClick={() => router.push("/login")} type="button">로그인하기</button></p>
    </AuthScreen>
  );
}
